// The one shape every data-layer failure has. Callers read `response.status`
// to tell a refusal (4xx: nothing was saved) from an uncertain outcome (5xx,
// including a dropped connection: the request may have been saved), and
// `response.data.error` for the machine-readable code. The browser test
// fixture throws this same class, so tests fail the way production does.
export class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.response = { status, data: { error: message } };
  }
}
