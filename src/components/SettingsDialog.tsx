import i18n from 'i18next';
import { Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize, useReturnFocus } from '@/hooks';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/utils';

const THEME_OPTIONS: t.ThemeOption[] = ['system', 'light', 'dark'];
const THEME_LABEL_KEYS: Record<t.ThemeOption, string> = {
  system: 'com_nav_theme_system',
  light: 'com_nav_theme_light',
  dark: 'com_nav_theme_dark',
};
const LANGUAGE_OPTIONS = ['en', 'zh-Hans'] as const;
type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];
const LANGUAGE_LABEL_KEYS: Record<LanguageOption, string> = {
  en: 'com_settings_language_en',
  'zh-Hans': 'com_settings_language_zh_hans',
};

export function SettingsDialog({ open, onClose }: t.SettingsDialogProps) {
  const localize = useLocalize();
  const returnFocus = useReturnFocus(open);
  const { theme, setTheme } = useTheme();
  const language: LanguageOption = i18n.resolvedLanguage === 'zh-Hans' ? 'zh-Hans' : 'en';

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        title={localize('com_ui_settings')}
        showClose
        onClose={onClose}
        onCloseAutoFocus={returnFocus}
        className="modal-frost"
      >
        <div className="flex flex-col gap-6 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-(--cui-color-text-default)">
                {localize('com_settings_language')}
              </span>
              <span className="text-xs text-(--cui-color-text-muted)">
                {localize('com_settings_language_desc')}
              </span>
            </div>
            <div
              className="flex w-fit gap-1 self-end rounded-lg border border-(--cui-color-stroke-default) p-0.5 sm:self-auto"
              role="group"
              aria-label={localize('com_settings_language')}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => void i18n.changeLanguage(option)}
                  className={cn(
                    'cursor-pointer rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors sm:px-3',
                    language === option
                      ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                      : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
                  )}
                  aria-pressed={language === option}
                >
                  {localize(LANGUAGE_LABEL_KEYS[option])}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-(--cui-color-text-default)">
                {localize('com_nav_theme')}
              </span>
              <span className="text-xs text-(--cui-color-text-muted)">
                {localize('com_settings_theme_desc')}
              </span>
            </div>
            <div className="flex w-fit gap-1 self-end rounded-lg border border-(--cui-color-stroke-default) p-0.5 sm:self-auto">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTheme(opt)}
                  className={cn(
                    'cursor-pointer rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors sm:px-3',
                    theme === opt
                      ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                      : 'text-(--cui-color-text-muted) hover:text-(--cui-color-text-default)',
                  )}
                  aria-pressed={theme === opt}
                >
                  {localize(THEME_LABEL_KEYS[opt])}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
