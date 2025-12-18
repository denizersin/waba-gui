import { useDebouncedCallback } from "use-debounce";
import { Input } from "../ui/input";
import React from "react";

export interface DebouncedInputProps extends Omit<React.ComponentProps<"input">, "onChange"> {
  debounceMs?: number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const DebouncedInput = React.forwardRef<HTMLInputElement, DebouncedInputProps>(
  ({ onChange, debounceMs = 300, value: externalValue, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState(
      externalValue ?? props.defaultValue ?? ""
    );

    // Sync internal value with external value prop if controlled
    React.useEffect(() => {
      if (externalValue !== undefined) {
        setInternalValue(String(externalValue));
      }
    }, [externalValue]);

    const debouncedOnChange = useDebouncedCallback(
      (value: string, target: HTMLInputElement) => {
        // Create a synthetic event object for the onChange callback
        const syntheticEvent = {
          target: { value },
          currentTarget: target,
        } as React.ChangeEvent<HTMLInputElement>;
        onChange?.(syntheticEvent);
      },
      debounceMs,
    );

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        const target = e.target;
        
        // Update UI immediately
        setInternalValue(value);
        
        // Debounce the onChange callback
        debouncedOnChange(value, target);
      },
      [debouncedOnChange],
    );

    return (
      <Input
        {...props}
        ref={ref}
        value={internalValue}
        onChange={handleChange}
      />
    );
  },
);

DebouncedInput.displayName = "DebouncedInput";