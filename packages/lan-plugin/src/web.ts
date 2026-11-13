import { WebPlugin } from '@capacitor/core';
import type { LanPlugin, LocalNetworkPermission } from './definitions';

/** Browsers cannot open UDP or server sockets, so LAN play needs the Android/iOS app. */
export class LanWeb extends WebPlugin implements Partial<LanPlugin> {
  private fail(): never {
    throw this.unavailable('Local Wi-Fi play needs the Android or iOS app.');
  }
  async startHost(): Promise<{ port: number; addresses: string[] }> {
    this.fail();
  }
  async stopHost(): Promise<void> {}
  async startDiscovery(): Promise<void> {
    this.fail();
  }
  async stopDiscovery(): Promise<void> {}
  async connect(): Promise<void> {
    this.fail();
  }
  async disconnect(): Promise<void> {}
  async send(): Promise<void> {
    this.fail();
  }
  async sendBatch(): Promise<void> {
    this.fail();
  }
  async getLocalAddresses(): Promise<{ addresses: string[] }> {
    return { addresses: [] };
  }
  async checkLocalNetwork(): Promise<{ status: LocalNetworkPermission }> {
    return { status: 'unknown' };
  }
  async openSettings(): Promise<void> {}
}
