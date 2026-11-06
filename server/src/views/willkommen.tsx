import { render } from 'preact-render-to-string';
import type { GuestWifi } from '../config.js';
import { names, Tabs } from './components.js';
import { iconSvg } from './icons.js';
import { page } from './page.js';
import { qrSvg, wifiPayload } from './qr.js';

/** About 5 cm on the Kindle's 167 ppi: phones read it from arm's length. */
export const QR_SCREEN_PX = 330;

export interface WillkommenModel {
  /** Visitors from the running «Besuch …» events; empty when guest mode was switched on by hand. */
  guests: string[];
  wifi: GuestWifi;
}

/** Shown instead of Heute during a visit: a greeting and the guest WLAN. A long press ends guest mode. */
function Willkommen({ m }: { m: WillkommenModel }) {
  return (
    <div class="screen view-willkommen">
      <div class="main" data-hold="guest">
        <div class="hello serif">
          Herzlich willkommen{m.guests.length > 0 ? <br /> : null}
          {m.guests.length > 0 ? `${names(m.guests)}!` : '!'}
        </div>
        <div class="qr" dangerouslySetInnerHTML={{ __html: qrSvg(wifiPayload(m.wifi), QR_SCREEN_PX) }} />
        <div class="wifi">
          <div>
            <span class="icon" dangerouslySetInnerHTML={{ __html: iconSvg('wifi', 44) }} /> WLAN <b>{m.wifi.ssid}</b>
          </div>
          {m.wifi.password ? (
            <div>
              Passwort <b>{m.wifi.password}</b>
            </div>
          ) : (
            <div>ohne Passwort</div>
          )}
        </div>
      </div>
      <Tabs active="heute" />
    </div>
  );
}

export function willkommenMarkup(m: WillkommenModel): string {
  return render(<Willkommen m={m} />);
}

export function willkommenHtml(m: WillkommenModel): string {
  return page(willkommenMarkup(m));
}
