"use client";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { completeFirstOrganizationOnboarding } from "@/api-client";

import { authErrorMessage } from "./auth-form-support";

interface OnboardingFields {
  branchAddress: string;
  branchName: string;
  branchPhone: string;
  displayName: string;
  organizationName: string;
  phone: string;
}

const initialFields: OnboardingFields = {
  branchAddress: "",
  branchName: "",
  branchPhone: "",
  displayName: "",
  organizationName: "",
  phone: "",
};

function requiredFieldsArePresent(fields: OnboardingFields): boolean {
  return [fields.displayName, fields.organizationName, fields.branchName].every(
    (value) => value.trim() !== "",
  );
}

export function OnboardingForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(initialFields);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof OnboardingFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    if (!requiredFieldsArePresent(fields)) {
      setError("Enter a display name, organization name, and branch name.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await completeFirstOrganizationOnboarding(fields);
      queryClient.removeQueries({ queryKey: ["access-context"] });
      router.replace("/app");
    } catch (requestError: unknown) {
      setError(
        authErrorMessage(requestError, {
          already_has_organization_access:
            "This account already has organization access and cannot use first onboarding.",
          already_onboarded:
            "This account has already completed first organization setup.",
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <TextField
        autoComplete="name"
        disabled={isSubmitting}
        id="onboarding-display-name"
        label="Display name"
        maxLength={200}
        onChange={(value) => updateField("displayName", value)}
        required
        value={fields.displayName}
      />
      <TextField
        autoComplete="tel"
        disabled={isSubmitting}
        id="onboarding-profile-phone"
        label="Profile phone (optional)"
        maxLength={32}
        onChange={(value) => updateField("phone", value)}
        value={fields.phone}
      />
      <TextField
        autoComplete="organization"
        disabled={isSubmitting}
        id="onboarding-organization-name"
        label="Organization name"
        maxLength={200}
        onChange={(value) => updateField("organizationName", value)}
        required
        value={fields.organizationName}
      />
      <TextField
        autoComplete="organization"
        disabled={isSubmitting}
        id="onboarding-branch-name"
        label="First branch name"
        maxLength={200}
        onChange={(value) => updateField("branchName", value)}
        required
        value={fields.branchName}
      />
      <TextField
        autoComplete="tel"
        disabled={isSubmitting}
        id="onboarding-branch-phone"
        label="Branch phone (optional)"
        maxLength={32}
        onChange={(value) => updateField("branchPhone", value)}
        value={fields.branchPhone}
      />
      <div>
        <Label className="form-field" htmlFor="onboarding-address">
          Branch address (optional)
        </Label>
        <Textarea
          className="mt-1"
          disabled={isSubmitting}
          id="onboarding-address"
          maxLength={500}
          name="branchAddress"
          onChange={(event) => updateField("branchAddress", event.target.value)}
          value={fields.branchAddress}
        />
      </div>
      {error === null ? null : (
        <p
          aria-live="assertive"
          className="text-sm text-destructive form-message"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Creating organization…" : "Create organization"}
      </Button>
    </form>
  );
}

function TextField({
  autoComplete,
  disabled,
  id,
  label,
  maxLength,
  onChange,
  required = false,
  value,
}: {
  autoComplete: string;
  disabled: boolean;
  id: string;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <div>
      <Label className="form-field" htmlFor={id}>
        {label}
      </Label>
      <Input
        autoComplete={autoComplete}
        className="mt-1"
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        name={id.replace("onboarding-", "")}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type="text"
        value={value}
      />
    </div>
  );
}
