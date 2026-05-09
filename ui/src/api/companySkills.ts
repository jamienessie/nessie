import type {
  CompanySkill,
  CompanySkillCatalogSearchResult,
  CompanySkillCatalogSourceId,
  CompanySkillCreateRequest,
  CompanySkillDetail,
  CompanySkillFileDetail,
  CompanySkillImportResult,
  CompanySkillListItem,
  CompanySkillProjectScanRequest,
  CompanySkillProjectScanResult,
  CompanySkillUpdateStatus,
} from "@nessie/shared";
import { api } from "./client";

export const companySkillsApi = {
  list: (companyId: string) =>
    api.get<CompanySkillListItem[]>(`/companies/${encodeURIComponent(companyId)}/skills`),
  detail: (companyId: string, skillId: string) =>
    api.get<CompanySkillDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  updateStatus: (companyId: string, skillId: string) =>
    api.get<CompanySkillUpdateStatus>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/update-status`,
    ),
  file: (companyId: string, skillId: string, relativePath: string) =>
    api.get<CompanySkillFileDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files?path=${encodeURIComponent(relativePath)}`,
    ),
  updateFile: (companyId: string, skillId: string, path: string, content: string) =>
    api.patch<CompanySkillFileDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`,
      { path, content },
    ),
  create: (companyId: string, payload: CompanySkillCreateRequest) =>
    api.post<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills`,
      payload,
    ),
  importFromSource: (companyId: string, source: string) =>
    api.post<CompanySkillImportResult>(
      `/companies/${encodeURIComponent(companyId)}/skills/import`,
      { source },
    ),
  searchCatalog: (
    companyId: string,
    sourceId: CompanySkillCatalogSourceId,
    q: string,
    limit: number = 12,
    offset: number = 0,
  ) =>
    api.get<CompanySkillCatalogSearchResult>(
      `/companies/${encodeURIComponent(companyId)}/skills/discovery?sourceId=${encodeURIComponent(sourceId)}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
  scanProjects: (companyId: string, payload: CompanySkillProjectScanRequest = {}) =>
    api.post<CompanySkillProjectScanResult>(
      `/companies/${encodeURIComponent(companyId)}/skills/scan-projects`,
      payload,
    ),
  installUpdate: (companyId: string, skillId: string) =>
    api.post<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/install-update`,
      {},
    ),
  delete: (companyId: string, skillId: string) =>
    api.delete<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}`,
    ),
};
