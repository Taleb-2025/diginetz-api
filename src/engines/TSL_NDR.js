export class TSL_NDR {
extract(event) {
if (event == null || typeof event === "object") {
throw new Error(“TSL_NDR_INVALID_INPUT”);
}

```
const value = Number(event);

if (!Number.isFinite(value)) {
  throw new Error("TSL_NDR_INVALID_EVENT");
}

const container = Math.floor(value / 10);
const extension = value % 10;

let containment;

if (extension < container) {
  containment = "DRAINING";
} else if (extension === container) {
  containment = "LAST_TRACE";
} else {
  containment = "ILLEGAL_TRACE";
}

return {
  container,
  extension,
  containment
};
```

}
}
