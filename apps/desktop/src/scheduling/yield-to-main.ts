/**
 * 让出主线程一个任务（SC-020 / app-spec §15「大量事件不应阻塞 UI 线程」）。
 *
 * 分片处理长循环时，片间把控制权交还事件循环，界面才能重绘、点击才有响应。
 *
 * 用 MessageChannel 而不是 setTimeout：Chromium 对隐藏页面会把定时器节流到
 * 每秒一次、长时间隐藏后降到每分钟一次，一次后台刷新的分片就会被拖成几十秒；
 * postMessage 产生的是普通任务，不受定时器节流影响。没有 MessageChannel 的
 * 环境退回 setTimeout(0)。
 *
 * 只维护一条通道与一份等待队列：一次 postMessage 唤醒当前全部等待者，
 * 不因为分片数增长而创建对象。
 */

type Waiter = () => void;

let waiters: Waiter[] = [];
/** 发送端；缺省表示尚未创建。MessageChannel 的消息投递到对端，因此发送与监听必须分属两个端口。 */
let post: ((value: null) => void) | undefined;
let unavailable = false;

function drainWaiters(): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) {
    resolve();
  }
}

function ensureChannel(): ((value: null) => void) | undefined {
  if (unavailable) {
    return undefined;
  }
  if (post === undefined) {
    if (typeof MessageChannel === "undefined") {
      unavailable = true;
      return undefined;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = drainWaiters;
    channel.port1.start();
    channel.port2.start();
    post = (value) => channel.port2.postMessage(value);
  }
  return post;
}

export function yieldToMain(): Promise<void> {
  const send = ensureChannel();
  if (send === undefined) {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return new Promise((resolve) => {
    waiters.push(resolve);
    send(null);
  });
}
