import { posts } from '../db.js';

export const dynamicConfig = {
  telegramSendLogs: true, // Default
};

export async function loadDynamicConfig() {
  const val = await posts.getAppConfig('telegram_send_logs');
  if (val !== null) {
    dynamicConfig.telegramSendLogs = val === 'true';
  }
}

export function setTelegramSendLogs(enabled: boolean) {
  dynamicConfig.telegramSendLogs = enabled;
}
