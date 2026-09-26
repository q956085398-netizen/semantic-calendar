/// <reference types="vite/client" />

/**
 * 构建期注入的应用版本（SC-022）：取值来自 package.json 的 version，
 * 由 vite.config.ts 的 define 写入，读取方是 settings/app-info.ts。
 */
declare const __APP_VERSION__: string;
