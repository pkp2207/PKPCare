/* eslint-disable no-unused-vars */
import { E164Number } from "libphonenumber-js/core";
import Image from "next/image";
import ReactDatePicker from "react-datepicker";
import { Control } from "react-hook-form";
import PhoneInput from "react-phone-number-input";

import { Checkbox } from "./ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";

export enum FormFieldType {
  INPUT = "input",
  TEXTAREA = "textarea",
  PHONE_INPUT = "phoneInput",
  CHECKBOX = "checkbox",
  DATE_PICKER = "datePicker",
  SELECT = "select",
  SKELETON = "skeleton",
}

interface CustomProps {
  control: Control<any>;
  name: string;
  label?: string;
  placeholder?: string;
  iconSrc?: string;
  iconAlt?: string;
  disabled?: boolean;
  /** Helper text, wired to the control with aria-describedby. */
  description?: string;
  /** Native input type for INPUT fields (email, tel, ...). */
  inputType?: string;
  /** HTML autocomplete token (WCAG 1.3.5), e.g. "name", "email", "tel". */
  autoComplete?: string;
  dateFormat?: string;
  showTimeSelect?: boolean;
  minDate?: Date;
  children?: React.ReactNode;
  renderSkeleton?: (field: any) => React.ReactNode;
  fieldType: FormFieldType;
}

// The shadcn overrides in globals.css remove the native focus ring from inputs
// (`focus-visible:ring-0 !important`), so focus is shown on the wrapper instead.
const FOCUS_WRAPPER =
  "rounded-md focus-within:ring-2 focus-within:ring-green-500 focus-within:ring-offset-2 focus-within:ring-offset-dark-300";

const minTimeFilter = (min?: Date) =>
  min ? (time: Date) => time.getTime() >= min.getTime() : undefined;

const RenderInput = ({ field, props }: { field: any; props: CustomProps }) => {
  switch (props.fieldType) {
    case FormFieldType.INPUT:
      return (
        <div
          className={`flex border border-dark-500 bg-dark-400 ${FOCUS_WRAPPER}`}
        >
          {props.iconSrc && (
            <Image
              src={props.iconSrc}
              height={24}
              width={24}
              alt=""
              aria-hidden="true"
              className="ml-2"
            />
          )}
          <FormControl>
            <Input
              type={props.inputType}
              autoComplete={props.autoComplete}
              placeholder={props.placeholder}
              disabled={props.disabled}
              {...field}
              className="shad-input border-0"
            />
          </FormControl>
        </div>
      );
    case FormFieldType.TEXTAREA:
      return (
        <div className={FOCUS_WRAPPER}>
          <FormControl>
            <Textarea
              placeholder={props.placeholder}
              {...field}
              className="shad-textArea"
              disabled={props.disabled}
            />
          </FormControl>
        </div>
      );
    case FormFieldType.PHONE_INPUT:
      return (
        <FormControl>
          <PhoneInput
            defaultCountry="US"
            placeholder={props.placeholder}
            international
            withCountryCallingCode
            value={field.value as E164Number | undefined}
            onChange={field.onChange}
            autoComplete="tel"
            className={`input-phone focus-within:ring-2 focus-within:ring-green-500 ${
              props.disabled ? "opacity-50" : ""
            }`}
            disabled={props.disabled}
          />
        </FormControl>
      );
    case FormFieldType.CHECKBOX:
      return (
        <FormControl>
          <div className="flex min-h-11 items-center gap-4">
            <Checkbox
              id={props.name}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
            <label htmlFor={props.name} className="checkbox-label py-3">
              {props.label}
            </label>
          </div>
        </FormControl>
      );
    case FormFieldType.DATE_PICKER:
      return (
        <div
          className={`flex border border-dark-500 bg-dark-400 ${FOCUS_WRAPPER}`}
        >
          <Image
            src="/assets/icons/calendar.svg"
            height={24}
            width={24}
            alt=""
            aria-hidden="true"
            className="ml-2"
          />
          <FormControl>
            <ReactDatePicker
              showTimeSelect={props.showTimeSelect ?? false}
              selected={field.value}
              onChange={(date: Date) => field.onChange(date)}
              minDate={props.minDate}
              // With a minimum, also block earlier times on the minimum day.
              filterTime={minTimeFilter(props.minDate)}
              timeInputLabel="Time:"
              dateFormat={props.dateFormat ?? "MM/dd/yyyy"}
              wrapperClassName="date-picker"
            />
          </FormControl>
        </div>
      );
    case FormFieldType.SELECT:
      return (
        <div className={FOCUS_WRAPPER}>
          <Select
            onValueChange={field.onChange}
            value={field.value ?? ""}
            disabled={props.disabled}
          >
            <FormControl>
              <SelectTrigger className="shad-select-trigger">
                <SelectValue placeholder={props.placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent className="shad-select-content">
              {props.children}
            </SelectContent>
          </Select>
        </div>
      );
    case FormFieldType.SKELETON:
      return props.renderSkeleton ? props.renderSkeleton(field) : null;
    default:
      return null;
  }
};

const CustomFormField = (props: CustomProps) => {
  const { control, name, label } = props;

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex-1">
          {props.fieldType !== FormFieldType.CHECKBOX && label && (
            <FormLabel className="shad-input-label">{label}</FormLabel>
          )}
          <RenderInput field={field} props={props} />

          {props.description && (
            <FormDescription className="text-12-regular !text-dark-700">
              {props.description}
            </FormDescription>
          )}
          <FormMessage className="shad-error" />
        </FormItem>
      )}
    />
  );
};

export default CustomFormField;
