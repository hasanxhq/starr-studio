import type { ReactNode } from "react";

import { Checkbox, Field, inputClass } from "./ui";

export function ProxyLogin({
  enabled,
  username,
  password,
  hasPassword,
  onEnabled,
  onUsername,
  onPassword,
  label,
  help,
}: {
  enabled: boolean;
  username: string;
  password: string;
  hasPassword: boolean;
  onEnabled: (value: boolean) => void;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  label: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Checkbox checked={enabled} onChange={onEnabled}>
        {label}
        {help && <span className="block text-xs text-muted">{help}</span>}
      </Checkbox>
      {enabled && (
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <Field label="Username">
              <input className={inputClass} autoComplete="off" value={username} onChange={(e) => onUsername(e.target.value)} />
            </Field>
          </div>
          <div className="min-w-0 flex-1 basis-48">
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => onPassword(e.target.value)}
                placeholder={hasPassword ? "Saved (leave empty to keep it)" : ""}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
