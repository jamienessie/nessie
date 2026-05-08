import type { InboxDismissal } from "@nessie/shared";
import { api } from "./client";

export const inboxDismissalsApi = {
  list: (companyId: string) => api.get<InboxDismissal[]>(`/companies/${companyId}/inbox-dismissals`),
  dismiss: (companyId: string, itemKey: string) =>
    api.post<InboxDismissal>(`/companies/${companyId}/inbox-dismissals`, { itemKey }),
};
