/** Presentation only: keep exact decimal digits and never round through Number. */
export function formatMoney(value: string, groupThousands = false): string {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    throw new RangeError("Money display requires a plain decimal string.");
  }
  const [integer = "0", fraction = ""] = value.split(".");
  const digits = fraction.replace(/0+$/, "").padEnd(2, "0");
  const whole = groupThousands
    ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : integer;
  return `${whole}.${digits}`;
}

export function formatThb(value: string, groupThousands = false): string {
  return `THB ${formatMoney(value, groupThousands)}`;
}
