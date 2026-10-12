/**
 * Optional packs: data Glossa doesn't ship, which the viewer installs on request (issue #37). A pack is
 * a pinned list of files with checksums. Nothing is downloaded until `installPack` is called from a
 * click, and the files then live in the extension's own IndexedDB, so the feature works offline.
 * Packs are data only: browsers don't run code downloaded by an extension.
 */
export interface PackFile {
  name: string;
  /** Size in bytes, for the progress bar. */
  bytes: number;
  sha256: string;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  /** Download size in MB, shown before the viewer installs. */
  sizeMB: number;
  /** Where the files come from, shown before the viewer installs and listed in the README's Privacy section. */
  host: string;
  baseUrl: string;
  files: readonly PackFile[];
}

export const JAPANESE_READINGS: Pack = {
  id: 'japanese-readings',
  name: 'Japanese readings',
  description: 'The dictionary behind furigana over kanji. Runs on your device.',
  sizeMB: 17.4,
  host: 'cdn.jsdelivr.net',
  // The npm package @sglkc/kuromoji at an exact version (Apache-2.0, IPAdic dictionary).
  baseUrl: 'https://cdn.jsdelivr.net/npm/@sglkc/kuromoji@1.1.0/dict/',
  files: [
    { name: 'base.dat.gz', bytes: 3956825, sha256: '0803327762e1c93ca731e4319ab8343340f2806bb84941207782cde9d2d5a8eb' },
    { name: 'cc.dat.gz', bytes: 1692067, sha256: '02b7631be0d4de3a1a75cd9f9cc51536e4f94c9e6b389b813e06ba0f6e7de765' },
    { name: 'check.dat.gz', bytes: 3111633, sha256: '193ae0035fff6fe812b58d9ee730e7a7d7ee601d918481ce51075c58114f6cc9' },
    { name: 'tid.dat.gz', bytes: 1605820, sha256: 'd43d831cb6fb0f0a411739cd287a6d5e998e121a8daca614df14a81a0dcac586' },
    { name: 'tid_map.dat.gz', bytes: 1485576, sha256: '33efd5ffd87a70f669add093fa39dee44341d58f940844ef107c8fd98bb795b2' },
    { name: 'tid_pos.dat.gz', bytes: 5916009, sha256: '60dbfc99a6ab993f30c5dab648bec6ad7f9aaefa5c14e1843837d95e509f8895' },
    { name: 'unk.dat.gz', bytes: 10512, sha256: 'f7f991cdeb9bfd3e9c0e4577cc50ee0815a11c508cccd444a9d3ab3c81521100' },
    { name: 'unk_char.dat.gz', bytes: 306, sha256: '9a8e86fd9aff32d323fbb59f5a7006f05927a11f8173c90712cc56293aeb3225' },
    { name: 'unk_compat.dat.gz', bytes: 338, sha256: '50f60aa29bc2e86c2903ab8c825bb6fa604d2b294d96941c1d3924259791899d' },
    { name: 'unk_invoke.dat.gz', bytes: 1140, sha256: '6b210889548457c3006913afd12c8b525562255f2709e404604be9614a25e94c' },
    { name: 'unk_map.dat.gz', bytes: 1190, sha256: '6df12460e5477230bb6fd9641def918b699fc0a8868016b6c9f794488630509b' },
    { name: 'unk_pos.dat.gz', bytes: 10540, sha256: '5b183a29f281acc7e0542beca47b83f7985047c0a2d27e78a66f32276be5ad11' },
  ],
};

export const PACKS: readonly Pack[] = [JAPANESE_READINGS];

const DB_NAME = 'glossa-packs';
const STORE = 'files';
const keyOf = (pack: Pack, name: string) => `${pack.id}/${name}`;

// IndexedDB rather than the Cache API: it holds binary files in every extension context and browser.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function isPackInstalled(pack: Pack): Promise<boolean> {
  const keys = (await withStore('readonly', (store) => store.getAllKeys())) ?? [];
  return pack.files.every((file) => keys.includes(keyOf(pack, file.name)));
}

/**
 * Downloads and verifies every file, then stores them all in one transaction, so a pack is installed
 * completely or not at all. `onProgress` gets a fraction from 0 to 1.
 */
export async function installPack(pack: Pack, onProgress: (fraction: number) => void = () => {}): Promise<void> {
  const total = pack.files.reduce((sum, file) => sum + file.bytes, 0);
  let done = 0;
  const downloaded: { file: PackFile; bytes: ArrayBuffer }[] = [];
  for (const file of pack.files) {
    const response = await fetch(pack.baseUrl + file.name);
    if (!response.ok) throw new Error(`Couldn’t download ${file.name} from ${pack.host} (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if ((await sha256Hex(bytes)) !== file.sha256) {
      throw new Error(`${file.name} from ${pack.host} didn’t match its checksum. Nothing was installed.`);
    }
    downloaded.push({ file, bytes });
    done += file.bytes;
    onProgress(done / total);
  }
  await withStore('readwrite', (store) => {
    for (const { file, bytes } of downloaded) store.put(bytes, keyOf(pack, file.name));
  });
}

export async function removePack(pack: Pack): Promise<void> {
  await withStore('readwrite', (store) => {
    for (const file of pack.files) store.delete(keyOf(pack, file.name));
  });
}

/** The bytes of one installed file, or undefined if it isn't installed. */
export async function readPackFile(pack: Pack, name: string): Promise<ArrayBuffer | undefined> {
  return withStore<ArrayBuffer>('readonly', (store) => store.get(keyOf(pack, name)));
}
