import overlayCss from '@/components/overlay/style.css?inline';
import hostCss from './host.css?inline';
import { createShadowRootUi, defineContentScript } from '#imports';
import { render } from 'preact';
import { Overlay } from '@/components/overlay/Overlay';
import { initialState } from '@/components/overlay/state';
import { getSettings } from '@/lib/settings';
import { createStore } from '@/lib/store';
import { VideoController } from './controller';

/** Where the overlay goes: inside the fullscreen element, so it stays visible there. */
function overlayParent(): Element {
  const fullscreen = document.fullscreenElement;
  if (fullscreen && !(fullscreen instanceof HTMLVideoElement)) return fullscreen;
  return document.body ?? document.documentElement;
}

/**
 * Interactive subtitles for any HTML5 video. It isn't in the manifest: the toolbar popup starts it on
 * the current tab (with the activeTab permission), and lib/video-sites.ts registers it for sites the
 * viewer chose. Starting it again replaces the running copy.
 */
export default defineContentScript({
  registration: 'runtime',
  // The CSS goes into the shadow root as a string; 'ui' mode would fetch it, which needs a
  // web-accessible resource on every site.
  cssInjectionMode: 'manual',
  async main(ctx) {
    // YouTube has its own integration.
    if (/(^|\.)youtube\.com$/.test(location.hostname)) return { videos: 0 };

    const store = createStore(initialState(await getSettings()));
    const controller = new VideoController(ctx, store);

    const ui = await createShadowRootUi(ctx, {
      name: 'glossa-video-overlay',
      position: 'inline',
      anchor: overlayParent,
      append: 'last',
      css: `${overlayCss}\n${hostCss}`,
      onMount(container) {
        render(<Overlay store={store} controller={controller} />, container);
        return container;
      },
      onRemove(container) {
        if (container) render(null, container);
      },
    });
    ui.mount();
    ctx.addEventListener(document, 'fullscreenchange', () => {
      ui.remove();
      ui.mount();
    });

    controller.start();
    return { videos: controller.videoCount() };
  },
});
