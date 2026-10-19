// What the site says about working offline and about personal data: the features, the questions and answers, and
// the privacy page's date. One source for the app's 關於 sheet, the text version for readers without JavaScript,
// the FAQPage structured data and llms.txt. Every sentence describes what the code does today — when storage, outside requests,
// cookies, statistics or third-party players change, change this file in the same edit (see CLAUDE.md).
// English versions are for events with "languages": ["zh", "en"]; core/i18n.js carries the same pairs.

export const PRIVACY_PATH = '/privacy/';
export const PRIVACY_UPDATED = '2026-10-19';

export const FEATURES = [
  {
    title: '離線可用', titleEn: 'Works offline',
    text: '加到手機主畫面後，沒有網路也能看時間表和你排好的團序。',
    textEn: 'Add it to your home screen and the timetable and your picks open without a connection.',
  },
  {
    title: '不用註冊、不蒐集個資', titleEn: 'No sign-up, no personal data',
    text: '團序只存在你的手機，不會上傳；沒有廣告，也沒有追蹤用的 cookie。',
    textEn: 'Your picks stay on your phone and are never uploaded. No ads, no tracking cookies.',
  },
];

export const FAQ = [
  {
    q: '沒有網路能用嗎？', qEn: 'Does it work without a connection?',
    a: '可以。打開過一次、加到手機主畫面後，沒有網路也能看時間表、排團序。時間表有更新時，要連上網路才會拿到新版。',
    aEn: 'Yes. After your first visit, add it to your home screen: the timetable and your picks open without a connection. Timetable updates arrive the next time you are online.',
  },
  {
    q: '需要註冊嗎？會蒐集我的資料嗎？', qEn: 'Do I need an account? Do you collect my data?',
    a: '不用註冊。團序只存在你的手機，不會上傳；沒有廣告，也沒有追蹤用的 cookie。網站只用不含 cookie 的匿名流量統計（Cloudflare Web Analytics）。長按打開藝人卡片時，才會載入 YouTube、Spotify、Apple Music 等外部播放器，載入後適用它們的隱私政策。',
    aEn: 'No account needed. Your picks stay on your phone and are never uploaded. No ads and no tracking cookies; the site counts visits anonymously with cookie-free Cloudflare Web Analytics. Players from YouTube, Spotify, Apple Music and others load only when you open an artist card, and then their own privacy policies apply.',
  },
  {
    q: '團序存在哪裡？換手機還在嗎？', qEn: 'Where are my picks saved? Will they move to a new phone?',
    a: '存在這支手機的瀏覽器裡，換手機或清除瀏覽器資料就不會在了。換手機前，在「我的團序」按「複製備份連結」，到新手機打開這個連結就能還原。在 iPhone 上，Safari 和加到主畫面的版本是分開存的。',
    aEn: 'In this phone\'s browser, so a new phone or clearing browser data starts empty. Before you switch, tap "Copy backup link" in My Schedule and open that link on the new phone to restore them. On iPhone, Safari and the home-screen app keep separate copies.',
  },
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// For readers without JavaScript (inside the text timetable, features.pages): the same features and questions the
// app shows in its 關於 sheet. Website only; the single-file artifact keeps picks in a Claude account.
export function staticAbout() {
  return `  <div class="static-about">
    <h3>特色</h3>
    <ul>
${FEATURES.map((f) => `      <li><b>${esc(f.title)}</b>：${esc(f.text)}</li>`).join('\n')}
    </ul>
    <h3>常見問題</h3>
${FAQ.map((x) => `    <h4>${esc(x.q)}</h4>\n    <p>${esc(x.a)}</p>`).join('\n')}
    <p><a href="${PRIVACY_PATH}">隱私說明</a></p>
  </div>`;
}

// What the app needs to show them in the 關於 sheet (the website build only).
export const aboutForPage = () => ({ features: FEATURES.map(({ title, text }) => ({ title, text })), faq: FAQ.map(({ q, a }) => ({ q, a })), privacy: PRIVACY_PATH });

export const faqJsonLd = () => ({
  '@type': 'FAQPage',
  mainEntity: FAQ.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
});

// The app as a free web application, for the event page and the homepage.
export const webAppJsonLd = ({ name, url, lang = 'zh-Hant-TW' }) => ({
  '@type': 'WebApplication',
  name, url, inLanguage: lang,
  applicationCategory: 'EntertainmentApplication',
  operatingSystem: '網頁瀏覽器（iPhone、Android、電腦都可以）',
  browserRequirements: '需要 JavaScript；加到手機主畫面後可離線使用',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
  featureList: ['離線可用', '免註冊', '不蒐集個人資料'],
});
