/**
 * Single place for values that describe *this* shop.
 *
 * These were scattered as literals across components, and had already drifted:
 * three different bot usernames were live at once (`KuPi_ShoP_Store_Bot` in
 * ShareCard and Home, `kupishop` in server.cjs, `styletech_shop` on the contact
 * page), so at least two of the three "open in Telegram" links pointed at a bot
 * that is not this one.
 *
 * Everything here can be overridden from the environment, so changing the bot
 * or the contact details is a deploy-time setting rather than a code edit.
 * See .env.example.
 */

const env = import.meta.env;

/** Telegram bot username, without the leading @. */
export const BOT_USERNAME: string =
  env.VITE_TELEGRAM_BOT_USERNAME || 'KuPi_ShoP_Store_Bot';

export const BOT_URL = `https://t.me/${BOT_USERNAME}`;

/**
 * Deep link that opens the Mini App, optionally on a specific screen.
 *
 * `startapp` is what opens the *Mini App*; `start` only opens a chat with the
 * bot and hands it a parameter.
 */
export function miniAppLink(startParam?: string): string {
  return startParam ? `${BOT_URL}?startapp=${encodeURIComponent(startParam)}` : BOT_URL;
}

export function productLink(slug: string): string {
  return miniAppLink(`product_${slug}`);
}

/** Public shop name, used in share text and page copy. */
export const SHOP_NAME: string = env.VITE_SHOP_NAME || 'Point Tech';

/**
 * Customer-facing contact details.
 *
 * These deliberately have NO fallbacks except the ones that are safe to guess.
 *
 * They used to default to values inherited from an earlier project
 * ("StyleTech") — the phone number `+998 90 123 45 67` is a sequential dummy,
 * and `info@example.uz` is not a real mailbox. A deploy that forgot the
 * VITE_CONTACT_* variables therefore published a plausible-looking phone number
 * belonging to a stranger, and customers would have called it. An empty value
 * that the page then hides is strictly better than a confident wrong one: the
 * shop looks incomplete instead of misdirecting people.
 *
 * `telegram` keeps a fallback because the bot username is this shop's by
 * definition, and the working hours keep theirs because they describe the
 * schedule rather than identify anyone.
 */
export const CONTACTS = {
  phone: env.VITE_CONTACT_PHONE || '',
  telegram: env.VITE_CONTACT_TELEGRAM || BOT_USERNAME,
  email: env.VITE_CONTACT_EMAIL || '',
  addressRu: env.VITE_CONTACT_ADDRESS_RU || '',
  addressUz: env.VITE_CONTACT_ADDRESS_UZ || '',
  hoursRu: env.VITE_CONTACT_HOURS_RU || '',
  hoursUz: env.VITE_CONTACT_HOURS_UZ || '',
} as const;

/** `tel:` needs the number without spaces or punctuation. */
export const CONTACT_PHONE_HREF = CONTACTS.phone
  ? `tel:${CONTACTS.phone.replace(/[^\d+]/g, '')}`
  : '';

// Surface the omission to whoever is running the app locally. Silent in
// production, where the page simply shows fewer rows.
if (import.meta.env.DEV) {
  const missing = Object.entries({
    VITE_CONTACT_PHONE: CONTACTS.phone,
    VITE_CONTACT_EMAIL: CONTACTS.email,
    VITE_CONTACT_ADDRESS_RU: CONTACTS.addressRu,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    console.warn(
      `[config] Contact details not set, those rows are hidden on /contact: ${missing.join(', ')}`
    );
  }
}
