"use client";

import { Control } from "react-hook-form";

import { IdPrefill } from "@/components/ai/IdPrefill";
import CustomFormField, { FormFieldType } from "@/components/CustomFormField";
import { FileUploader } from "@/components/FileUploader";
import { FormControl } from "@/components/ui/form";
import { SelectItem } from "@/components/ui/select";
import { IdentificationTypes } from "@/constants";

import { applyIdPrefill, type IdPrefillFields } from "../wizard";

export const InsuranceStep = ({
  control,
  file,
  onApplyPrefill,
}: {
  control: Control<any>;
  file: File | null;
  onApplyPrefill: (values: ReturnType<typeof applyIdPrefill>) => void;
}) => (
  <div className="space-y-6">
    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.INPUT}
        control={control}
        name="insuranceProvider"
        label="Insurance provider"
        placeholder="BlueCross BlueShield"
      />
      <CustomFormField
        fieldType={FormFieldType.INPUT}
        control={control}
        name="insurancePolicyNumber"
        label="Insurance policy number"
        placeholder="ABC123456789"
      />
    </div>

    <CustomFormField
      fieldType={FormFieldType.SELECT}
      control={control}
      name="identificationType"
      label="Identification type"
      placeholder="Select identification type"
    >
      {IdentificationTypes.map((type) => (
        <SelectItem key={type} value={type}>
          {type}
        </SelectItem>
      ))}
    </CustomFormField>

    <CustomFormField
      fieldType={FormFieldType.INPUT}
      control={control}
      name="identificationNumber"
      label="Identification number (optional)"
      placeholder="123456789"
    />

    <CustomFormField
      fieldType={FormFieldType.SKELETON}
      control={control}
      name="identificationDocument"
      label="Scanned copy of identification document (optional)"
      description="Your document is not saved in your browser. It is uploaded only when you submit."
      renderSkeleton={(field) => (
        <FormControl>
          <FileUploader files={field.value} onChange={field.onChange} />
        </FormControl>
      )}
    />

    <IdPrefill
      file={file}
      onApply={(fields) => onApplyPrefill(applyIdPrefill(fields as IdPrefillFields))}
    />
  </div>
);
