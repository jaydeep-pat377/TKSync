import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import {getLocales} from 'react-native-localize';
import en from './locales/en.json';
import frCA from './locales/fr-CA.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';

const locale = getLocales()[0];
const langTag = locale?.languageTag ?? 'en'; // e.g. "fr-CA", "pt-BR"
const langCode = locale?.languageCode ?? 'en'; // e.g. "fr", "pt"

// Match full tag first (fr-CA, pt-BR), then fall back to base language code
const supportedLangs = ['en', 'fr-CA', 'es', 'pt-BR'];
const detectedLang =
  supportedLangs.includes(langTag) ? langTag :
  langCode === 'fr' ? 'fr-CA' :
  langCode === 'pt' ? 'pt-BR' :
  supportedLangs.includes(langCode) ? langCode :
  'en';

i18n.use(initReactI18next).init({
  resources: {
    en: {translation: en},
    'fr-CA': {translation: frCA},
    es: {translation: es},
    'pt-BR': {translation: ptBR},
  },
  lng: detectedLang,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
} as Parameters<typeof i18n.init>[0]);

export default i18n;
