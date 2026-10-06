"use client";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/providers/language-provider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { ProductBarcodeLabels } from "./product-barcode-labels";

import { formatMoney } from "@/money-display";
import {
  applicationContextUrl,
  resolveApplicationContext,
} from "@/application-context";
import {
  type AccessibleOrganization,
  fetchAccessContext,
} from "@/branch-api-client";
import {
  type CatalogApiErrorKind,
  CatalogApiError,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogRequestContext,
  createCategory,
  createProduct,
  listCategories,
  listProducts,
  PRODUCT_UNITS,
  setCategoryLifecycle,
  setProductLifecycle,
  updateCategory,
  updateProduct,
} from "@/catalog-api-client";

type CatalogView = "categories" | "products";
type CategoryPage = Awaited<ReturnType<typeof listCategories>>;
type ProductPage = Awaited<ReturnType<typeof listProducts>>;
type CatalogRole = AccessibleOrganization["role"];

const MANAGEMENT_ROLES = new Set<CatalogRole>([
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
  "INVENTORY_STAFF",
]);
const LIFECYCLE_ROLES = new Set<CatalogRole>([
  "OWNER",
  "ADMIN",
  "BRANCH_MANAGER",
]);
const BRANCH_SCOPED_ROLES = new Set<CatalogRole>([
  "BRANCH_MANAGER",
  "INVENTORY_STAFF",
  "CASHIER",
]);

function catalogUrl(organizationId: string, branchId: string | null): string {
  const params = new URLSearchParams({ organizationId });
  if (branchId !== null) params.set("branchId", branchId);
  return `/app/catalog?${params.toString()}`;
}

function catalogScopeKey(context: CatalogRequestContext): readonly unknown[] {
  return context.branchId === undefined
    ? ["organization-scoped", context.organizationId, "catalog"]
    : ["branch-scoped", context.organizationId, context.branchId, "catalog"];
}

function errorMessage(error: unknown): string {
  if (!(error instanceof CatalogApiError))
    return "The catalog is temporarily unavailable.";
  const messages: Record<CatalogApiErrorKind, string> = {
    authentication_required: "Sign in again to continue.",
    barcode_conflict: "That barcode already exists in this organization.",
    branch_context_required: "Choose a valid active branch to use the catalog.",
    category_inactive:
      "The selected category is no longer active. Refresh the category choices.",
    category_name_conflict:
      "That category name already exists in this organization.",
    category_not_found:
      "That category is no longer available. Refresh the list.",
    category_stale:
      "This item changed since you opened it. Refresh the latest version before trying again.",
    forbidden: "This catalog action is not available for your current access.",
    invalid_cursor: "The catalog list changed. The first page was reloaded.",
    product_not_found: "That product is no longer available. Refresh the list.",
    product_stale:
      "This item changed since you opened it. Refresh the latest version before trying again.",
    sku_conflict: "That SKU already exists in this organization.",
    unavailable: "The catalog is temporarily unavailable. Try again.",
    validation: "Check the submitted values and try again.",
  };
  return messages[error.kind];
}

function isStaleError(error: unknown): boolean {
  return (
    error instanceof CatalogApiError &&
    (error.kind === "category_stale" || error.kind === "product_stale")
  );
}

function safeBasePrice(value: string): boolean {
  return /^\d+(?:\.\d{1,4})?$/.test(value);
}

function StatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  return (
    <Badge variant="outline" data-status={status.toLowerCase()}>
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </Badge>
  );
}

function Field({
  label,
  name,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
}) {
  const id = useId();
  return (
    <Label className="form-field" htmlFor={id}>
      {label}
      <Input
        className={name === "basePrice" ? "form-control--numeric" : ""}
        id={id}
        name={name}
        type="text"
        {...props}
      />
    </Label>
  );
}

function TextareaField({
  label,
  name,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  name: string;
}) {
  const id = useId();
  return (
    <Label className="form-field sm:col-span-full" htmlFor={id}>
      {label}
      <Textarea className="" id={id} name={name} {...props} />
    </Label>
  );
}

export function CatalogManagement() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedOrganizationId = searchParams.get("organizationId");
  const requestedBranchId = searchParams.get("branchId");
  const contextQuery = useQuery({
    queryFn: fetchAccessContext,
    queryKey: ["access-context"],
  });
  const resolved = contextQuery.data
    ? resolveApplicationContext(
        contextQuery.data,
        requestedOrganizationId,
        requestedBranchId,
      )
    : null;

  useEffect(() => {
    if (
      resolved?.organization === null ||
      resolved?.organization === undefined
    ) {
      return;
    }
    const canonical = catalogUrl(
      resolved.organization.id,
      resolved.branch?.id ?? null,
    );
    const current = catalogUrl(
      requestedOrganizationId ?? "",
      requestedBranchId,
    );
    if (canonical !== current) router.replace(canonical);
  }, [requestedBranchId, requestedOrganizationId, resolved, router]);

  if (contextQuery.isPending) return <p aria-live="polite">Loading access…</p>;
  if (contextQuery.isError)
    return (
      <p className="form-message" role="alert">
        Your access context could not be loaded.
      </p>
    );
  if (resolved?.organization === null) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Catalog unavailable</h1>
        <p className="text-muted-foreground">
          Choose an active organization from the workspace before managing its
          catalog.
        </p>
        <Link className="underline" href="/app">
          Return to workspace
        </Link>
      </section>
    );
  }
  if (resolved === null) return null;
  return (
    <CatalogContent
      branch={resolved.branch}
      organization={resolved.organization}
    />
  );
}

function CatalogContent({
  branch,
  organization,
}: {
  branch: AccessibleOrganization["branches"][number] | null;
  organization: AccessibleOrganization;
}) {
  if (BRANCH_SCOPED_ROLES.has(organization.role) && branch === null) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Branch context required</h1>
        <p className="text-muted-foreground">
          Choose an active assigned branch in the workspace before using the
          catalog.
        </p>
        <Link
          className="underline"
          href={applicationContextUrl(organization.id, null)}
        >
          Return to workspace
        </Link>
      </section>
    );
  }
  return <CatalogContentLoaded branch={branch} organization={organization} />;
}

function CatalogContentLoaded({
  branch,
  organization,
}: {
  branch: AccessibleOrganization["branches"][number] | null;
  organization: AccessibleOrganization;
}) {
  const { t } = useLanguage();

  const queryClient = useQueryClient();
  const [view, setView] = useState<CatalogView>("products");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const role = organization.role;
  const requestContext: CatalogRequestContext = {
    ...(branch === null ? {} : { branchId: branch.id }),
    organizationId: organization.id,
  };
  const canManage = MANAGEMENT_ROLES.has(role);
  const canLifecycle = LIFECYCLE_ROLES.has(role);
  const canIncludeInactive = canManage || canLifecycle;
  const scopeKey = catalogScopeKey(requestContext);
  const categoryOptionsQuery = useQuery({
    queryFn: () => listCategories(requestContext, { limit: 100 }),
    queryKey: [...scopeKey, "category-options"],
  });
  const categoryQuery = useInfiniteQuery<
    CategoryPage,
    Error,
    InfiniteData<CategoryPage>,
    readonly unknown[],
    string | null
  >({
    getNextPageParam: (page) => page.meta.nextCursor,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      listCategories(requestContext, {
        cursor: pageParam,
        includeInactive,
        q: categorySearch,
      }),
    queryKey: [
      ...scopeKey,
      "categories",
      { includeInactive, q: categorySearch },
    ],
  });
  const productQuery = useInfiniteQuery<
    ProductPage,
    Error,
    InfiniteData<ProductPage>,
    readonly unknown[],
    string | null
  >({
    getNextPageParam: (page) => page.meta.nextCursor,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      listProducts(requestContext, {
        ...(categoryFilter === "" ? {} : { categoryId: categoryFilter }),
        cursor: pageParam,
        includeInactive,
        q: productSearch,
      }),
    queryKey: [
      ...scopeKey,
      "products",
      { categoryId: categoryFilter, includeInactive, q: productSearch },
    ],
  });

  const refreshCatalog = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: scopeKey });
  };
  const handleError = (error: unknown) => {
    setNotice(errorMessage(error));
    if (error instanceof CatalogApiError && error.kind === "invalid_cursor") {
      void refreshCatalog();
    }
  };

  const categories =
    categoryQuery.data?.pages.flatMap((page) => page.data.categories) ?? [];
  const products =
    productQuery.data?.pages.flatMap((page) => page.data.products) ?? [];
  const categoryNames = new Map(
    [...(categoryOptionsQuery.data?.data.categories ?? []), ...categories].map(
      (category) => [category.id, category.name],
    ),
  );

  return (
    <section className="w-full space-y-8">
      <header className="space-y-2">
        <Link
          className="text-sm underline"
          href={applicationContextUrl(organization.id, branch?.id ?? null)}
        >
          {t("backToWorkspace")}
        </Link>
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <p className="text-muted-foreground">
          Manage products and categories for {organization.name}.
        </p>
      </header>

      {notice ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"
          role="alert"
        >
          <p>{notice}</p>
          {isStaleError(categoryQuery.error) ||
          isStaleError(productQuery.error) ? null : (
            <Button
              variant="outline"
              onClick={() => void refreshCatalog()}
              type="button"
            >
              Refresh latest
            </Button>
          )}
        </div>
      ) : null}

      <div
        aria-label="Catalog views"
        className="flex gap-2 border-b"
        role="tablist"
      >
        <Button
          variant={view === "products" ? "secondary" : "outline"}
          aria-controls="products-panel"
          aria-selected={view === "products"}
          className=""
          onClick={() => setView("products")}
          role="tab"
          type="button"
        >
          Products
        </Button>
        <Button
          variant={view === "categories" ? "secondary" : "outline"}
          aria-controls="categories-panel"
          aria-selected={view === "categories"}
          className=""
          onClick={() => setView("categories")}
          role="tab"
          type="button"
        >
          Categories
        </Button>
      </div>

      {canIncludeInactive ? (
        <Label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <Checkbox
            className=""
            checked={includeInactive}
            onCheckedChange={(checked) => setIncludeInactive(checked)}
          />
          Include inactive catalog records
        </Label>
      ) : null}

      {view === "products" ? (
        <section
          aria-labelledby="products-heading"
          id="products-panel"
          role="tabpanel"
        >
          <h2 className="sr-only" id="products-heading">
            Products
          </h2>
          {canManage ? (
            <ProductCreateForm
              categories={categoryOptionsQuery.data?.data.categories ?? []}
              context={requestContext}
              onError={handleError}
              onSaved={refreshCatalog}
            />
          ) : null}
          <ProductListControls
            categories={categoryOptionsQuery.data?.data.categories ?? []}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            onSearch={setProductSearch}
            search={productSearch}
          />
          <CatalogListState
            emptyMessage="No products match this catalog view."
            error={productQuery.error}
            isEmpty={products.length === 0}
            isPending={productQuery.isPending}
            onRefresh={refreshCatalog}
          >
            <div className="grid gap-4">
              {products.map((product) => (
                <ProductEditor
                  canLifecycle={canLifecycle}
                  canManage={canManage}
                  categories={categoryOptionsQuery.data?.data.categories ?? []}
                  categoryName={
                    product.categoryId === null
                      ? null
                      : (categoryNames.get(product.categoryId) ??
                        "Current inactive category")
                  }
                  context={requestContext}
                  key={product.id}
                  onError={handleError}
                  onSaved={refreshCatalog}
                  product={product}
                />
              ))}
            </div>
            <LoadMore
              hasNextPage={productQuery.hasNextPage}
              isPending={productQuery.isFetchingNextPage}
              onLoadMore={() => void productQuery.fetchNextPage()}
            />
          </CatalogListState>
        </section>
      ) : (
        <section
          aria-labelledby="categories-heading"
          className="space-y-5"
          id="categories-panel"
          role="tabpanel"
        >
          <h2 className="sr-only" id="categories-heading">
            Categories
          </h2>
          {canManage ? (
            <CategoryCreateForm
              context={requestContext}
              onError={handleError}
              onSaved={refreshCatalog}
            />
          ) : null}
          <SearchControl onSearch={setCategorySearch} search={categorySearch} />
          <CatalogListState
            emptyMessage="No categories match this catalog view."
            error={categoryQuery.error}
            isEmpty={categories.length === 0}
            isPending={categoryQuery.isPending}
            onRefresh={refreshCatalog}
          >
            <div className="grid gap-4">
              {categories.map((category) => (
                <CategoryEditor
                  canLifecycle={canLifecycle}
                  canManage={canManage}
                  category={category}
                  context={requestContext}
                  key={category.id}
                  onError={handleError}
                  onSaved={refreshCatalog}
                />
              ))}
            </div>
            <LoadMore
              hasNextPage={categoryQuery.hasNextPage}
              isPending={categoryQuery.isFetchingNextPage}
              onLoadMore={() => void categoryQuery.fetchNextPage()}
            />
          </CatalogListState>
        </section>
      )}
    </section>
  );
}

function CatalogListState({
  children,
  emptyMessage,
  error,
  isEmpty,
  isPending,
  onRefresh,
}: {
  children: React.ReactNode;
  emptyMessage: string;
  error: Error | null;
  isEmpty: boolean;
  isPending: boolean;
  onRefresh: () => Promise<void>;
}) {
  if (isPending) return <p aria-live="polite">Loading catalog…</p>;
  if (error)
    return (
      <div className="space-y-3" role="alert">
        <p>{errorMessage(error)}</p>
        <Button
          variant="outline"
          onClick={() => void onRefresh()}
          type="button"
        >
          Refresh latest
        </Button>
      </div>
    );
  if (isEmpty) return <p>{emptyMessage}</p>;
  return <>{children}</>;
}

function LoadMore({
  hasNextPage,
  isPending,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isPending: boolean;
  onLoadMore: () => void;
}) {
  if (!hasNextPage) return null;
  return (
    <div className="mt-4">
      <Button
        variant="outline"
        disabled={isPending}
        onClick={onLoadMore}
        type="button"
      >
        {isPending ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}

function SearchControl({
  onSearch,
  search,
}: {
  onSearch: (value: string) => void;
  search: string;
}) {
  return (
    <form
      className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end [&>label]:flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(String(new FormData(event.currentTarget).get("q") ?? ""));
      }}
    >
      <Field defaultValue={search} label="Search catalog" name="q" />
      <Button type="submit">Search</Button>
    </form>
  );
}

function ProductListControls({
  categories,
  categoryFilter,
  onCategoryFilterChange,
  onSearch,
  search,
}: {
  categories: CatalogCategory[];
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  onSearch: (value: string) => void;
  search: string;
}) {
  const categorySelectId = useId();
  return (
    <div className="my-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem] md:items-end">
      <SearchControl onSearch={onSearch} search={search} />
      <Label className="form-field" htmlFor={categorySelectId}>
        Category filter
        <NativeSelect
          className="w-full "
          id={categorySelectId}
          onChange={(event) => onCategoryFilterChange(event.target.value)}
          value={categoryFilter}
        >
          <NativeSelectOption value="">All categories</NativeSelectOption>
          <NativeSelectOption value="uncategorized">
            Uncategorized
          </NativeSelectOption>
          {categories.map((category) => (
            <NativeSelectOption key={category.id} value={category.id}>
              {category.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
    </div>
  );
}

function CategoryCreateForm({
  context,
  onError,
  onSaved,
}: {
  context: CatalogRequestContext;
  onError: (error: unknown) => void;
  onSaved: () => Promise<void>;
}) {
  const mutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return createCategory(context, {
        description: String(data.get("description") ?? ""),
        name: String(data.get("name") ?? ""),
      });
    },
    onSuccess: onSaved,
  });
  return (
    <form
      className="rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        void mutation
          .mutateAsync(form)
          .then(() => form.reset())
          .catch(onError);
      }}
    >
      <h2 className="font-semibold">Create category</h2>
      <div className="mt-4 mb-4 grid max-w-4xl items-start gap-4 sm:grid-cols-2">
        <Field label="Category name" name="name" required />
        <TextareaField label="Description (optional)" name="description" />
      </div>
      <Button
        aria-busy={mutation.isPending}
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? "Creating…" : "Create category"}
      </Button>
    </form>
  );
}

function CategoryEditor({
  canLifecycle,
  canManage,
  category,
  context,
  onError,
  onSaved,
}: {
  canLifecycle: boolean;
  canManage: boolean;
  category: CatalogCategory;
  context: CatalogRequestContext;
  onError: (error: unknown) => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLanguage();

  const updateMutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return updateCategory(context, category.id, {
        description: String(data.get("description") ?? ""),
        expectedUpdatedAt: category.updatedAt,
        name: String(data.get("name") ?? ""),
      });
    },
    onSuccess: onSaved,
  });
  const lifecycleMutation = useMutation({
    mutationFn: () => setCategoryLifecycle(context, category),
    onSuccess: onSaved,
  });
  const pending = updateMutation.isPending || lifecycleMutation.isPending;
  return (
    <form
      className="rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void updateMutation.mutateAsync(event.currentTarget).catch(onError);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{category.name}</h3>
        <StatusBadge status={category.status} />
      </div>
      {canManage ? (
        <div className="mt-4 mb-4 grid max-w-4xl items-start gap-4 sm:grid-cols-2">
          <Field
            defaultValue={category.name}
            label="Category name"
            name="name"
            required
          />
          <TextareaField
            defaultValue={category.description ?? ""}
            label="Description (optional)"
            name="description"
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {category.description ?? "No description"}
        </p>
      )}
      {canManage || canLifecycle ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {canManage ? (
            <Button
              variant="outline"
              aria-busy={updateMutation.isPending}
              disabled={pending}
              type="submit"
            >
              {t("saveChanges")}
            </Button>
          ) : null}
          {canLifecycle ? (
            <Button
              variant="outline"
              aria-busy={lifecycleMutation.isPending}
              disabled={pending}
              onClick={() =>
                void lifecycleMutation.mutateAsync().catch(onError)
              }
              type="button"
            >
              {category.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function ProductCreateForm({
  categories,
  context,
  onError,
  onSaved,
}: {
  categories: CatalogCategory[];
  context: CatalogRequestContext;
  onError: (error: unknown) => void;
  onSaved: () => Promise<void>;
}) {
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      const basePrice = String(data.get("basePrice") ?? "");
      if (!safeBasePrice(basePrice)) {
        throw new CatalogApiError("validation");
      }
      return createProduct(context, {
        barcode: String(data.get("barcode") ?? ""),
        basePrice,
        categoryId: String(data.get("categoryId") ?? "") || null,
        description: String(data.get("description") ?? ""),
        name: String(data.get("name") ?? ""),
        sku: String(data.get("sku") ?? ""),
        unit: String(
          data.get("unit") ?? "EA",
        ) as (typeof PRODUCT_UNITS)[number],
      });
    },
    onSuccess: onSaved,
  });
  const unitId = useId();
  const categoryId = useId();
  return (
    <form
      className="rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setValidation(null);
        void mutation
          .mutateAsync(form)
          .then(() => form.reset())
          .catch((error: unknown) => {
            setValidation(errorMessage(error));
            onError(error);
          });
      }}
    >
      <h2 className="font-semibold">Create product</h2>
      <div className="mt-4 mb-4 grid max-w-5xl items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Product name" name="name" required />
        <Field label="SKU" name="sku" required />
        <Field label="Barcode (optional)" name="barcode" />
        <Field
          inputMode="decimal"
          label="Base price"
          name="basePrice"
          required
        />
        <Label className="form-field" htmlFor={unitId}>
          Unit
          <NativeSelect
            className="w-full form-control--compact"
            defaultValue="EA"
            id={unitId}
            name="unit"
          >
            {PRODUCT_UNITS.map((unit) => (
              <NativeSelectOption key={unit}>{unit}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="form-field" htmlFor={categoryId}>
          Category (optional)
          <NativeSelect className="w-full " id={categoryId} name="categoryId">
            <NativeSelectOption value="">Uncategorized</NativeSelectOption>
            {categories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {category.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <TextareaField label="Description (optional)" name="description" />
      </div>
      {validation ? (
        <p className="mt-3 text-sm form-message" role="alert">
          {validation}
        </p>
      ) : null}
      <Button
        aria-busy={mutation.isPending}
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? "Creating…" : "Create product"}
      </Button>
    </form>
  );
}

function ProductEditor({
  canLifecycle,
  canManage,
  categories,
  categoryName,
  context,
  onError,
  onSaved,
  product,
}: {
  canLifecycle: boolean;
  canManage: boolean;
  categories: CatalogCategory[];
  categoryName: string | null;
  context: CatalogRequestContext;
  onError: (error: unknown) => void;
  onSaved: () => Promise<void>;
  product: CatalogProduct;
}) {
  const { t } = useLanguage();

  const [validation, setValidation] = useState<string | null>(null);
  const updateMutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      const basePrice = String(data.get("basePrice") ?? "");
      if (!safeBasePrice(basePrice)) throw new CatalogApiError("validation");
      return updateProduct(context, product.id, {
        barcode: String(data.get("barcode") ?? ""),
        basePrice,
        categoryId: String(data.get("categoryId") ?? "") || null,
        description: String(data.get("description") ?? ""),
        expectedUpdatedAt: product.updatedAt,
        name: String(data.get("name") ?? ""),
        sku: String(data.get("sku") ?? ""),
      });
    },
    onSuccess: onSaved,
  });
  const lifecycleMutation = useMutation({
    mutationFn: () => setProductLifecycle(context, product),
    onSuccess: onSaved,
  });
  const categorySelectId = useId();
  const pending = updateMutation.isPending || lifecycleMutation.isPending;
  const needsCurrentCategoryOption =
    product.categoryId !== null &&
    !categories.some(({ id }) => id === product.categoryId);
  return (
    <form
      aria-label={`Edit product ${product.name}`}
      className="rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setValidation(null);
        void updateMutation
          .mutateAsync(event.currentTarget)
          .catch((error: unknown) => {
            setValidation(errorMessage(error));
            onError(error);
          });
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{product.name}</h3>
          <p className="text-sm text-muted-foreground">
            {product.sku} · {formatMoney(product.basePrice)} · {product.unit}
          </p>
        </div>
        <StatusBadge status={product.status} />
      </div>
      {canManage ? (
        <div className="mt-4 mb-4 grid max-w-5xl items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field
            defaultValue={product.name}
            label="Product name"
            name="name"
            required
          />
          <Field defaultValue={product.sku} label="SKU" name="sku" required />
          <Field
            defaultValue={product.barcode ?? ""}
            label="Barcode (optional)"
            name="barcode"
          />
          <Field
            defaultValue={product.basePrice}
            inputMode="decimal"
            label="Base price"
            name="basePrice"
            required
          />
          <Label className="form-field" htmlFor={categorySelectId}>
            Category (optional)
            <NativeSelect
              className="w-full "
              defaultValue={product.categoryId ?? ""}
              id={categorySelectId}
              name="categoryId"
            >
              <NativeSelectOption value="">Uncategorized</NativeSelectOption>
              {needsCurrentCategoryOption ? (
                <NativeSelectOption value={product.categoryId ?? ""}>
                  {categoryName}
                </NativeSelectOption>
              ) : null}
              {categories.map((category) => (
                <NativeSelectOption key={category.id} value={category.id}>
                  {category.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <p className="self-end text-sm text-muted-foreground">
            Unit: {product.unit} (immutable)
          </p>
          <TextareaField
            defaultValue={product.description ?? ""}
            label="Description (optional)"
            name="description"
          />
        </div>
      ) : (
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Category</dt>
            <dd>{categoryName ?? "Uncategorized"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Barcode</dt>
            <dd>{product.barcode ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Description</dt>
            <dd>{product.description ?? "No description"}</dd>
          </div>
        </dl>
      )}
      <ProductBarcodeLabels product={product} />
      {validation ? (
        <p className="mt-3 text-sm form-message" role="alert">
          {validation}
        </p>
      ) : null}
      {canManage || canLifecycle ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {canManage ? (
            <Button
              variant="outline"
              aria-busy={updateMutation.isPending}
              disabled={pending}
              type="submit"
            >
              {t("saveChanges")}
            </Button>
          ) : null}
          {canLifecycle ? (
            <Button
              variant="outline"
              aria-busy={lifecycleMutation.isPending}
              disabled={pending}
              onClick={() =>
                void lifecycleMutation.mutateAsync().catch(onError)
              }
              type="button"
            >
              {product.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
