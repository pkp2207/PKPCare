"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileRejection, useDropzone } from "react-dropzone";

import { convertFileToUrl } from "@/lib/utils";
import {
  ALLOWED_ID_DOCUMENT_TYPES,
  MAX_ID_DOCUMENT_BYTES,
} from "@/lib/validation";

import { FormError } from "./FormError";

const ACCEPT_ATTRIBUTE = [
  ...ALLOWED_ID_DOCUMENT_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
].join(",");

/**
 * Mirrors the server-side rules (type allow-list, max size). Returns a
 * user-facing message, or null when the file is acceptable.
 */
export const validateIdentificationFile = (file: File): string | null => {
  const allowed: readonly string[] = ALLOWED_ID_DOCUMENT_TYPES;

  if (!allowed.includes(file.type)) {
    return "Unsupported file type. Please upload a JPG, PNG, WebP or PDF.";
  }

  if (file.size > MAX_ID_DOCUMENT_BYTES) {
    return `File is too large. The maximum size is ${MAX_ID_DOCUMENT_BYTES / (1024 * 1024)} MB.`;
  }

  return null;
};

type FileUploaderProps = {
  files: File[] | undefined;
  onChange: (files: File[]) => void;
};

export const FileUploader = ({ files, onChange }: FileUploaderProps) => {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        const [{ errors }] = fileRejections;
        setError(
          errors[0]?.code === "too-many-files"
            ? "Please upload a single file."
            : errors[0]?.message ?? "This file can't be uploaded."
        );
        return;
      }

      setError(null);
      onChange(acceptedFiles);
    },
    [onChange]
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    multiple: false,
    validator: (file) => {
      const message = validateIdentificationFile(file);
      return message ? { code: "invalid-file", message } : null;
    },
  });

  const file = files?.[0];
  const isImage = !!file && file.type.startsWith("image/");

  // One object URL per selected file; released when it changes or unmounts.
  const previewUrl = useMemo(
    () => (file && isImage ? convertFileToUrl(file) : null),
    [file, isImage]
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <>
      <div
        {...getRootProps({
          className:
            "file-upload focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-300",
        })}
      >
        <input
          {...getInputProps({ accept: ACCEPT_ATTRIBUTE })}
          aria-label="Upload identification document"
          aria-describedby="id-upload-help"
        />
        {file ? (
          <>
            {previewUrl ? (
              <Image
                src={previewUrl}
                width={1000}
                height={1000}
                alt="Preview of the uploaded identification document"
                className="max-h-[400px] overflow-hidden object-cover"
              />
            ) : (
              <p className="text-14-regular break-all">{file.name}</p>
            )}
            <p className="text-12-regular text-dark-700">
              Click or drop another file to replace it.
            </p>
          </>
        ) : (
          <>
            <Image
              src="/assets/icons/upload.svg"
              width={40}
              height={40}
              alt=""
              aria-hidden="true"
            />
            <div className="file-upload_label !text-dark-700">
              <p className="text-14-regular ">
                <span className="text-green-500">Click to upload </span>
                or drag and drop
              </p>
              <p id="id-upload-help" className="text-12-regular">
                JPG, PNG, WebP or PDF (max. 5 MB)
              </p>
            </div>
          </>
        )}
      </div>
      <FormError message={error} className="mt-2" />
    </>
  );
};
