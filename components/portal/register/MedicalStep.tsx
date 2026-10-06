"use client";

import Image from "next/image";
import { Control } from "react-hook-form";

import CustomFormField, { FormFieldType } from "@/components/CustomFormField";
import { SelectItem } from "@/components/ui/select";

export const MedicalStep = ({
  control,
  doctors,
}: {
  control: Control<any>;
  doctors: { name: string; image: string; specialty?: string }[];
}) => (
  <div className="space-y-6">
    <CustomFormField
      fieldType={FormFieldType.SELECT}
      control={control}
      name="primaryPhysician"
      label="Primary care physician"
      placeholder="Select a physician"
    >
      {doctors.map((doctor) => (
        <SelectItem key={doctor.name} value={doctor.name}>
          <div className="flex cursor-pointer items-center gap-2">
            <Image
              src={doctor.image}
              width={32}
              height={32}
              alt=""
              className="rounded-full border border-dark-500"
            />
            <span>
              {doctor.name}
              {doctor.specialty && <span className="text-dark-700"> - {doctor.specialty}</span>}
            </span>
          </div>
        </SelectItem>
      ))}
    </CustomFormField>

    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.TEXTAREA}
        control={control}
        name="allergies"
        label="Allergies (optional)"
        placeholder="Peanuts, Penicillin, Pollen"
      />
      <CustomFormField
        fieldType={FormFieldType.TEXTAREA}
        control={control}
        name="currentMedication"
        label="Current medications (optional)"
        placeholder="Ibuprofen 200mg, Levothyroxine 50mcg"
      />
    </div>

    <div className="flex flex-col gap-6 xl:flex-row">
      <CustomFormField
        fieldType={FormFieldType.TEXTAREA}
        control={control}
        name="familyMedicalHistory"
        label="Family medical history (optional)"
        placeholder="Mother had brain cancer, Father has hypertension"
      />
      <CustomFormField
        fieldType={FormFieldType.TEXTAREA}
        control={control}
        name="pastMedicalHistory"
        label="Past medical history (optional)"
        placeholder="Appendectomy in 2015, Asthma diagnosis in childhood"
      />
    </div>

    <p className="text-12-regular text-dark-700">
      To protect your health information, these answers are not saved in your browser if you leave
      this page.
    </p>
  </div>
);
