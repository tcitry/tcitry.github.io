import {Description, Label, Switch} from '@heroui/react';

type EmailPreferenceSwitchProps = {
  label: string;
  description?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange: (value: boolean) => void;
};

export default function EmailPreferenceSwitch({label, description, isSelected, isDisabled, onChange}: EmailPreferenceSwitchProps) {
  return <Switch size="sm" className="w-full" isSelected={isSelected} isDisabled={isDisabled} onChange={onChange}>
    <Switch.Content className="w-full flex-row items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Label>{label}</Label>
        {description ? <Description>{description}</Description> : null}
      </div>
      <Switch.Control><Switch.Thumb /></Switch.Control>
    </Switch.Content>
  </Switch>;
}
