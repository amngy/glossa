import '@/components/overlay/style.css';
import './host.css';
import { createShadowRootUi, defineContentScript } from '#imports';
import { render } from 'preact';
import { Overlay } from '@/components/overlay/Overlay';
import { initialState } from '@/components/overlay/state';
import { getSettings } from '@/lib/settings';
import { createStore } from '@/lib/store';
import { YouTubeController } from './controller';

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const store = createStore(initialState(await getSettings()));
    const controller = new YouTubeController(ctx, store);

    const ui = await createShadowRootUi(ctx, {
      name: 'glossa-overlay',
      position: 'inline',
      // Inside the player, so the overlay follows it into fullscreen and theater mode.
      anchor: '#movie_player',
      append: 'last',
      // The host is positioned over the player by the `:host` rule in host.css.
      onMount(container) {
        render(<Overlay store={store} controller={controller} />, container);
        return container;
      },
      onRemove(container) {
        if (container) render(null, container);
      },
    });
    // The player element is created and replaced as YouTube navigates.
    ui.autoMount();

    controller.start();
  },
});
