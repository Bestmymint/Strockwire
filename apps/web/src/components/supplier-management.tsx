"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  applicationContextUrl,
  resolveApplicationContext,
} from "@/application-context";
import { fetchAccessContext } from "@/branch-api-client";
import {
  createSupplier,
  listSuppliers,
  setSupplierLifecycle,
  supplierScopeKey,
  SupplierApiError,
  type Supplier,
  type SupplierInput,
  type SupplierStatusFilter,
  updateSupplier,
} from "@/supplier-api-client";

const MANAGEMENT_ROLES = new Set([
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
  "INVENTORY_STAFF",
]);
const LIFECYCLE_ROLES = new Set(["OWNER", "ADMIN"]);
const emptyInput: SupplierInput = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
};
function message(error: unknown): string {
  if (error instanceof SupplierApiError) {
    if (error.kind === "forbidden")
      return "You do not have permission for suppliers.";
    if (error.kind === "validation")
      return "Check the supplier fields and try again.";
    if (error.kind === "not_found")
      return "That supplier is no longer available.";
  }
  return "Supplier data could not be loaded. Try again.";
}

export function SupplierManagement() {
  const params = useSearchParams();
  const contextQuery = useQuery({
    queryKey: ["access-context"],
    queryFn: fetchAccessContext,
  });
  if (contextQuery.isPending) return <p aria-live="polite">Loading access…</p>;
  if (contextQuery.isError || contextQuery.data === undefined)
    return <p role="alert">Your access context could not be loaded.</p>;
  const context = contextQuery.data;
  const resolved = resolveApplicationContext(
    context,
    params.get("organizationId"),
    params.get("branchId"),
  );
  if (resolved.organization === null)
    return (
      <p role="alert">Choose an organization before managing suppliers.</p>
    );
  return (
    <SupplierContent
      organization={resolved.organization}
      branchId={resolved.branch?.id ?? null}
    />
  );
}
function SupplierContent({
  organization,
  branchId,
}: {
  organization: {
    id: string;
    name: string;
    role: "OWNER" | "ADMIN" | "BRANCH_MANAGER" | "INVENTORY_STAFF" | "CASHIER";
  };
  branchId: string | null;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupplierStatusFilter>("active");
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = MANAGEMENT_ROLES.has(organization.role);
  const canLifecycle = LIFECYCLE_ROLES.has(organization.role);
  const scope = supplierScopeKey(organization.id);
  const suppliers = useInfiniteQuery({
    queryKey: [...scope, search, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listSuppliers(organization.id, { cursor: pageParam, q: search, status }),
    getNextPageParam: (last) => last.meta.nextCursor,
  });
  const refresh = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: scope });
  };
  if (!canManage)
    return (
      <section className="space-y-4">
        <Link
          className="text-sm underline"
          href={applicationContextUrl(organization.id, branchId)}
        >
          Back to workspace
        </Link>
        <h1 className="text-2xl font-semibold">Suppliers</h1>
        <p role="alert">You do not have permission to access suppliers.</p>
      </section>
    );
  const records =
    suppliers.data?.pages.flatMap((page) => page.data.suppliers) ?? [];
  return (
    <section className="w-full space-y-6">
      <header>
        <Link
          className="text-sm underline"
          href={applicationContextUrl(organization.id, branchId)}
        >
          Back to workspace
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Suppliers</h1>
        <p className="text-muted-foreground">
          Manage suppliers for {organization.name}.
        </p>
      </header>
      {notice ? <p role="alert">{notice}</p> : null}
      <SupplierForm
        label="Create supplier"
        onError={(error) => setNotice(message(error))}
        onSave={(input) => createSupplier(organization.id, input).then(refresh)}
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <label className="grid gap-1 text-sm font-medium">
          Search suppliers
          <input
            className="min-h-11 rounded-md border bg-background px-3"
            defaultValue={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Status
          <select
            className="min-h-11 rounded-md border bg-background px-3"
            onChange={(event) =>
              setStatus(event.target.value as SupplierStatusFilter)
            }
            value={status}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </label>
        <button
          className="min-h-11 self-end rounded-md border px-4 text-sm font-medium"
          onClick={() => void refresh()}
          type="button"
        >
          Refresh
        </button>
      </div>
      {suppliers.isPending ? (
        <p aria-live="polite">Loading suppliers…</p>
      ) : suppliers.isError ? (
        <p role="alert">{message(suppliers.error)}</p>
      ) : records.length === 0 ? (
        <p>No suppliers match this view.</p>
      ) : (
        <div className="grid gap-4">
          {records.map((supplier) => (
            <SupplierCard
              canLifecycle={canLifecycle}
              key={supplier.id}
              onError={(error) => setNotice(message(error))}
              onSave={refresh}
              organizationId={organization.id}
              supplier={supplier}
            />
          ))}
        </div>
      )}
      {suppliers.hasNextPage ? (
        <button
          className="min-h-11 rounded-md border px-4 text-sm font-medium"
          disabled={suppliers.isFetchingNextPage}
          onClick={() => void suppliers.fetchNextPage()}
          type="button"
        >
          {suppliers.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
function SupplierForm({
  initial = emptyInput,
  label,
  onError,
  onSave,
}: {
  initial?: SupplierInput;
  label: string;
  onError: (error: unknown) => void;
  onSave: (input: SupplierInput) => Promise<unknown>;
}) {
  const mutation = useMutation({ mutationFn: onSave });
  return (
    <form
      className="rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        void mutation
          .mutateAsync({
            name: String(form.get("name") ?? ""),
            contactName: String(form.get("contactName") ?? ""),
            email: String(form.get("email") ?? ""),
            phone: String(form.get("phone") ?? ""),
            address: String(form.get("address") ?? ""),
          })
          .then(() => {
            if (label === "Create supplier") formElement.reset();
          })
          .catch(onError);
      }}
    >
      <h2 className="font-semibold">{label}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          defaultValue={initial.name}
          label="Supplier name"
          name="name"
          required
        />
        <Field
          defaultValue={initial.contactName}
          label="Contact name (optional)"
          name="contactName"
        />
        <Field
          defaultValue={initial.email}
          label="Email (optional)"
          name="email"
          type="email"
        />
        <Field
          defaultValue={initial.phone}
          label="Phone (optional)"
          name="phone"
        />
        <label className="grid gap-1 text-sm font-medium sm:col-span-2">
          Address (optional)
          <textarea
            className="min-h-24 rounded-md border bg-background px-3 py-2"
            defaultValue={initial.address}
            name="address"
          />
        </label>
      </div>
      <button
        aria-busy={mutation.isPending}
        className="mt-4 min-h-11 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? "Saving…" : label}
      </button>
    </form>
  );
}
function SupplierCard({
  canLifecycle,
  onError,
  onSave,
  organizationId,
  supplier,
}: {
  canLifecycle: boolean;
  onError: (error: unknown) => void;
  onSave: () => Promise<void>;
  organizationId: string;
  supplier: Supplier;
}) {
  const edit = useMutation({
    mutationFn: (input: SupplierInput) =>
      updateSupplier(organizationId, supplier.id, input),
    onSuccess: onSave,
  });
  const lifecycle = useMutation({
    mutationFn: () => setSupplierLifecycle(organizationId, supplier),
    onSuccess: onSave,
  });
  const pending = edit.isPending || lifecycle.isPending;
  return (
    <article className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{supplier.name}</h2>
        <span className="rounded-full border px-2 py-1 text-xs">
          {supplier.status === "ACTIVE" ? "Active" : "Inactive"}
        </span>
      </div>
      <SupplierForm
        initial={{
          name: supplier.name,
          contactName: supplier.contactName ?? "",
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          address: supplier.address ?? "",
        }}
        label="Save changes"
        onError={onError}
        onSave={(input) => edit.mutateAsync(input)}
      />
      {canLifecycle ? (
        <button
          aria-busy={lifecycle.isPending}
          className="mt-3 min-h-11 rounded-md border px-4 text-sm font-medium"
          disabled={pending}
          onClick={() => void lifecycle.mutateAsync().catch(onError)}
          type="button"
        >
          {supplier.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
        </button>
      ) : null}
    </article>
  );
}
function Field({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue: string;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="min-h-11 rounded-md border bg-background px-3"
        defaultValue={defaultValue}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
