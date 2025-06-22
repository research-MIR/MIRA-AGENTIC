import { commonTranslations } from './common';
import { chatTranslations } from './chat';
import { projectsTranslations } from './projects';
import { generatorTranslations } from './generator';
import { galleryTranslations } from './gallery';
import { refineTranslations } from './refine';
import { vtoTranslations } from './vto';
import { editorTranslations } from './editor';
import { errorTranslations } from './errors';
import { onboardingTranslations } from './onboarding';

const modules = [
  commonTranslations,
  chatTranslations,
  projectsTranslations,
  generatorTranslations,
  galleryTranslations,
  refineTranslations,
  vtoTranslations,
  editorTranslations,
  errorTranslations,
  onboardingTranslations,
];

export const translations = modules.reduce((acc, module) => {
  for (const lang in module) {
    if (acc[lang]) {
      Object.assign(acc[lang], module[lang]);
    } else {
      acc[lang] = module[lang];
    }
  }
  return acc;
}, {} as Record<string, Record<string, string>>);