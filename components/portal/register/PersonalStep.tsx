"use client";

import { Control } from "react-hook-form";

import CustomFormField, { FormFieldType } from "@/components/CustomFormField";
import { FormControl } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { GenderOptions } from "@/constants";

export const PersonalStep = ({ control }: { control: Control<any> }) => (
  <div className="space-y-6">
    <CustomFormField
      fieldType={FormFieldType.INPUT}
      control={control}
      name="name"
      label="Full name"
      placeholder="Param Pathak"
      iconSrc="/assets/icons/user.svg"
      autoComplete="name"
    />

    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.INPUT}
        control={control}
        name="email"
        label="Email address"
        placeholder="pkp@gmail.com"
        iconSrc="/assets/icons/email.svg"
        inputType="email"
        autoComplete="email"
      />
      <CustomFormField
        fieldType={FormFieldType.PHONE_INPUT}
        control={control}
        name="phone"
        label="Phone number"
        placeholder="(555) 123-4567"
      />
    </div>

    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.DATE_PICKER}
        control={control}
        name="birthDate"
        label="Date of birth"
      />
      <CustomFormField
        fieldType={FormFieldType.SKELETON}
        control={control}
        name="gender"
        label="Gender"
        renderSkeleton={(field) => (
          <FormControl>
            <RadioGroup
              aria-label="Gender"
              className="flex min-h-11 flex-wrap gap-3 xl:justify-between"
              onValueChange={field.onChange}
              value={field.value}
            >
              {GenderOptions.map((option) => (
                <div key={option} className="radio-group min-h-11">
                  <RadioGroupItem value={option} id={`gender-${option}`} />
                  <Label htmlFor={`gender-${option}`} className="cursor-pointer py-2">
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </FormControl>
        )}
      />
    </div>

    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.INPUT}
        control={control}
        name="address"
        label="Address"
        placeholder="14 street, New York, NY - 5101"
        autoComplete="street-address"
      />
      <CustomFormField
        fieldType={FormFieldType.INPUT}
        control={control}
        name="occupation"
        label="Occupation"
        placeholder="Software Engineer"
        autoComplete="organization-title"
      />
    </div>

    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.INPUT}
        control={control}
        name="emergencyContactName"
        label="Emergency contact name"
        placeholder="Guardian's name"
      />
      <CustomFormField
        fieldType={FormFieldType.PHONE_INPUT}
        control={control}
        name="emergencyContactNumber"
        label="Emergency contact number"
        placeholder="(555) 123-4567"
      />
    </div>
  </div>
);
