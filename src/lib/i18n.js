import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ar from '../locales/ar.json'

const RTL_LANGS = ['ar']

// Read language from localStorage → profile.locale (set later) → default 'en'.
const startLng = (() => {
  try { return localStorage.getItem('pca.lng') || 'en' } catch { return 'en' }
})()

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    lng: startLng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })

applyDirection(startLng)

export function setLanguage(lng) {
  try { localStorage.setItem('pca.lng', lng) } catch {}
  i18n.changeLanguage(lng)
  applyDirection(lng)
}

function applyDirection(lng) {
  const rtl = RTL_LANGS.includes(lng)
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr')
  document.documentElement.setAttribute('lang', lng)
}

export default i18n
