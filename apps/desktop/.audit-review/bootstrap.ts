// Disposable review harness. Production UI and data pipeline are unchanged.
// The desktop IO boundary uses an isolated browser store; never user data.
const key = 'sc-review-2026-09-26-isolated-snapshot';
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  async invoke(command: string, args: Record<string, unknown> = {}) {
    if (command === 'data_store_read') return localStorage.getItem(key + ':' + String(args.fileName));
    if (command === 'data_store_write') { localStorage.setItem(key + ':' + String(args.fileName), String(args.contents)); return; }
    if (command === 'data_store_rename') {
      const from = key + ':' + String(args.fromName);
      const to = key + ':' + String(args.toName);
      const contents = localStorage.getItem(from);
      if (contents === null) throw new Error('隔离验收文件不存在');
      localStorage.setItem(to, contents);
      localStorage.removeItem(from);
      return;
    }
    if (command === 'shell_set_close_behavior') return { behavior: args.behavior, trayAvailable: true };
    if (command === 'notification_status' || command === 'notification_request_permission') return { permission: 'denied' };
    if (command === 'notification_send') throw { kind: 'permission-denied', message: '隔离验收不发送系统通知' };
    if (command === 'webcal_fetch') {
      if (String(args.url).startsWith('https://demo.invalid/')) {
        if (args.etag === '"demo"') return { status: 304, notModified: true };
        return { status: 200, notModified: false, etag: '"demo"', body: [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semantic Calendar//Review//EN',
          'BEGIN:VEVENT', 'UID:named-subscription-review@example.invalid',
          'SUMMARY:订阅日程示例', 'DTSTART:20260926T140000Z', 'DTEND:20260926T143000Z',
          'END:VEVENT', 'END:VCALENDAR', '',
        ].join('\r\n') };
      }
      throw new Error('隔离验收不请求远程订阅');
    }
    throw new Error('Unexpected command: ' + command);
  },
};
await import('/src/main.tsx');
