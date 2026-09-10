import { useState } from 'react';
import type { Bootstrap, Preferences } from '../../../shared/contracts';

export interface SettingsDraftOptions {
  boot: Bootstrap;
  onClose(): void;
  onSave(value: Bootstrap): void;
}

/** Mount-local desktop draft. Publish precedes runtime feedback; closing does not cancel host work. */
export function useSettingsDraft({ boot, onClose, onSave }: SettingsDraftOptions) {
  const [value, setValue] = useState<Preferences>(boot.preferences);
  const [args, setArgs] = useState(JSON.stringify(value.args));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (key: 'piPath' | 'nodePath') => {
    try {
      const selected = await window.desktop.chooseFile();
      if (selected) setValue(current => ({ ...current, [key]: selected }));
    } catch (error) { setError(String(error)); }
  };
  const save = () => {
    setBusy(true);
    setError('');
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) throw new Error('参数必须是 JSON 字符串数组');
      void window.desktop.savePreferences({ ...value, args: parsed }).then(result => {
        onSave(result);
        if (result.runtimeError) { setError(result.runtimeError); setBusy(false); }
        else onClose();
      }).catch(error => { setError(String(error)); setBusy(false); });
    } catch (error) { setError(String(error)); setBusy(false); }
  };

  return { value, setValue, args, setArgs, error, busy, pick, save };
}
