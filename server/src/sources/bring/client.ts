import { randomUUID } from 'node:crypto';
import type { Clock } from '../../clock.js';
import type { FetchFn } from '../../http.js';
import { TIMEOUT_MS } from '../../http.js';

export const BRING_BASE = 'https://api.getbring.com/rest/';
/** Public key embedded in the Bring! apps (see miaucl/bring-api const.py). */
export const BRING_API_KEY = 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp';

/** The app's purchase conditions of an item; «Dringend» is `urgent`. */
export interface PurchaseConditions {
  urgent: boolean;
  convenient: boolean;
  discounted: boolean;
}

export interface BringItem {
  uuid: string;
  itemId: string;
  specification: string;
  conditions: PurchaseConditions;
}

export interface BringItems {
  purchase: BringItem[];
  recently: BringItem[];
}

export interface BringApi {
  lists(): Promise<{ listUuid: string; name: string }[]>;
  items(listUuid: string): Promise<BringItems>;
  add(listUuid: string, itemId: string, spec?: string): Promise<void>;
  /**
   * Ticks an item off: Bring! moves it from «purchase» to «recently», like the app does.
   * `uuid` must be the entry's own uuid from items(); Bring! ignores a change with an unknown one.
   */
  complete(listUuid: string, itemId: string, spec: string, uuid: string): Promise<void>;
  /** Replaces an entry's purchase conditions (all three, as the app sends them). */
  setConditions(listUuid: string, itemId: string, spec: string, uuid: string, conditions: PurchaseConditions): Promise<void>;
}

interface Session {
  uuid: string;
  publicUuid: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  uuid?: string;
  publicUuid?: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const REFRESH_MARGIN_MS = 3_600_000;
const FORM = 'application/x-www-form-urlencoded';

const CONDITIONS = 'PURCHASE_CONDITIONS';

function toConditions(attributes: unknown): PurchaseConditions {
  const found = Array.isArray(attributes) ? attributes.find((a) => a && typeof a === 'object' && a.type === CONDITIONS) : undefined;
  const c = (found?.content ?? {}) as Record<string, unknown>;
  return { urgent: c.urgent === true, convenient: c.convenient === true, discounted: c.discounted === true };
}

function toItems(raw: unknown): BringItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object')
    .map((i) => ({
      uuid: String(i.uuid ?? ''),
      itemId: String(i.itemId ?? ''),
      specification: String(i.specification ?? ''),
      conditions: toConditions(i.attributes),
    }))
    .filter((i) => i.itemId !== '');
}

export class BringClient implements BringApi {
  private session: Session | null = null;
  private readonly newUuid: () => string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly creds: { email: string; password: string },
    private readonly fetchFn: FetchFn,
    private readonly clock: Clock,
    opts: { newUuid?: () => string; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.newUuid = opts.newUuid ?? randomUUID;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async lists(): Promise<{ listUuid: string; name: string }[]> {
    const session = await this.ensureSession();
    const res = await this.request('GET', `bringusers/${session.uuid}/lists`);
    const body = (await res.json()) as { lists?: { listUuid?: unknown; name?: unknown }[] };
    return (body.lists ?? []).map((l) => ({ listUuid: String(l.listUuid), name: String(l.name) }));
  }

  async items(listUuid: string): Promise<BringItems> {
    const res = await this.request('GET', `v2/bringlists/${listUuid}`);
    const body = (await res.json()) as { items?: { purchase?: unknown; recently?: unknown } };
    return { purchase: toItems(body.items?.purchase), recently: toItems(body.items?.recently) };
  }

  async add(listUuid: string, itemId: string, spec = ''): Promise<void> {
    await this.change(listUuid, itemId, spec, this.newUuid(), 'TO_PURCHASE');
  }

  async complete(listUuid: string, itemId: string, spec: string, uuid: string): Promise<void> {
    await this.change(listUuid, itemId, spec, uuid, 'TO_RECENTLY');
  }

  async setConditions(listUuid: string, itemId: string, spec: string, uuid: string, conditions: PurchaseConditions): Promise<void> {
    await this.change(listUuid, itemId, spec, uuid, 'ATTRIBUTE_UPDATE', { attribute: { type: CONDITIONS, content: conditions } });
  }

  private async change(
    listUuid: string,
    itemId: string,
    spec: string,
    uuid: string,
    operation: 'TO_PURCHASE' | 'TO_RECENTLY' | 'ATTRIBUTE_UPDATE',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.request('PUT', `v2/bringlists/${listUuid}/items`, {
      changes: [{ accuracy: '0.0', altitude: '0.0', latitude: '0.0', longitude: '0.0', itemId, spec, ...(uuid ? { uuid } : {}), operation, ...extra }],
      sender: '',
    });
  }

  private headers(session: Session): Record<string, string> {
    return {
      Authorization: `Bearer ${session.accessToken}`,
      'X-BRING-API-KEY': BRING_API_KEY,
      'X-BRING-CLIENT': 'android',
      'X-BRING-APPLICATION': 'bring',
      'X-BRING-COUNTRY': 'CH',
      'X-BRING-USER-UUID': session.uuid,
      'X-BRING-PUBLIC-USER-UUID': session.publicUuid,
    };
  }

  private expiry(expiresIn: number): number {
    return this.clock().getTime() + Math.max(0, expiresIn * 1000 - REFRESH_MARGIN_MS);
  }

  private async login(): Promise<Session> {
    const res = await this.fetchFn(`${BRING_BASE}v2/bringauth`, {
      method: 'POST',
      headers: { 'Content-Type': FORM },
      body: new URLSearchParams({ email: this.creds.email, password: this.creds.password }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`bring login HTTP ${res.status}`);
    const t = (await res.json()) as TokenResponse;
    this.session = {
      uuid: String(t.uuid),
      publicUuid: String(t.publicUuid),
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? '',
      expiresAt: this.expiry(t.expires_in),
    };
    return this.session;
  }

  /** Returns false when the refresh token is rejected with any 4xx (caller must log in again). */
  private async refresh(session: Session): Promise<boolean> {
    const res = await this.fetchFn(`${BRING_BASE}v2/bringauth/token`, {
      method: 'POST',
      headers: { ...this.headers(session), 'Content-Type': FORM },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 400 && res.status < 500) return false;
    if (!res.ok) throw new Error(`bring refresh HTTP ${res.status}`);
    const t = (await res.json()) as TokenResponse;
    this.session = {
      ...session,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? session.refreshToken,
      expiresAt: this.expiry(t.expires_in),
    };
    return true;
  }

  private async renew(session: Session): Promise<Session> {
    if (await this.refresh(session)) return this.session as Session;
    return this.login();
  }

  private async ensureSession(): Promise<Session> {
    if (!this.session) return this.login();
    if (this.clock().getTime() >= this.session.expiresAt) return this.renew(this.session);
    return this.session;
  }

  private send(session: Session, method: string, path: string, json?: unknown): Promise<Response> {
    const headers = this.headers(session);
    let body: string | undefined;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    return this.fetchFn(`${BRING_BASE}${path}`, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  private async request(method: string, path: string, json?: unknown): Promise<Response> {
    let session = await this.ensureSession();
    let res = await this.send(session, method, path, json);
    if (res.status === 401) {
      session = await this.renew(session);
      res = await this.send(session, method, path, json);
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      await this.sleep(1000 + Math.random() * 4000);
      res = await this.send(session, method, path, json);
    }
    if (!res.ok) throw new Error(`bring ${method} HTTP ${res.status}`);
    return res;
  }
}
