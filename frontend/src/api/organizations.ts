import client from "./client";
import {
  OrgMember,
  OrganizationCoachMessage,
  OrganizationDirectMessage,
  OrganizationDiscoverResponse,
  OrganizationGroupMessage,
} from "../pages/dashboard/types";

export const discoverOrganizations = async (query?: string): Promise<OrganizationDiscoverResponse> => {
  const response = await client.get<OrganizationDiscoverResponse>("/users/organizations/discover", {
    params: query?.trim() ? { query: query.trim() } : undefined,
  });
  return response.data;
};

export const requestOrganizationJoin = async (organizationId: number): Promise<{ message: string; status: string }> => {
  const response = await client.post<{ message: string; status: string }>("/users/organization/request-join", {
    organization_id: organizationId,
  });
  return response.data;
};

export const listOrganizationGroupMessages = async (organizationId: number): Promise<OrganizationGroupMessage[]> => {
  const response = await client.get<OrganizationGroupMessage[]>(`/communications/organizations/${organizationId}/group`);
  return response.data;
};

export const postOrganizationGroupMessage = async (
  organizationId: number,
  body: string,
  attachmentUrl?: string,
  attachmentName?: string,
): Promise<OrganizationGroupMessage> => {
  const response = await client.post<OrganizationGroupMessage>(`/communications/organizations/${organizationId}/group`, {
    body,
    attachment_url: attachmentUrl ?? null,
    attachment_name: attachmentName ?? null,
  });
  return response.data;
};

export const listOrganizationCoachMessages = async (
  organizationId: number,
  params: { coachId?: number; athleteId?: number },
): Promise<OrganizationCoachMessage[]> => {
  const response = await client.get<OrganizationCoachMessage[]>(`/communications/organizations/${organizationId}/coach-chat`, {
    params: {
      ...(typeof params.coachId === "number" ? { coach_id: params.coachId } : {}),
      ...(typeof params.athleteId === "number" ? { athlete_id: params.athleteId } : {}),
    },
  });
  return response.data;
};

export const postOrganizationCoachMessage = async (
  organizationId: number,
  params: { coachId?: number; athleteId?: number },
  body: string,
  attachmentUrl?: string,
  attachmentName?: string,
): Promise<OrganizationCoachMessage> => {
  const response = await client.post<OrganizationCoachMessage>(
    `/communications/organizations/${organizationId}/coach-chat`,
    { body, attachment_url: attachmentUrl ?? null, attachment_name: attachmentName ?? null },
    {
      params: {
        ...(typeof params.coachId === "number" ? { coach_id: params.coachId } : {}),
        ...(typeof params.athleteId === "number" ? { athlete_id: params.athleteId } : {}),
      },
    },
  );
  return response.data;
};

export const listOrgMembers = async (organizationId: number): Promise<OrgMember[]> => {
  const response = await client.get<OrgMember[]>(`/communications/organizations/${organizationId}/members`);
  return response.data;
};

export const listOrgDirectMessages = async (
  organizationId: number,
  userId: number,
): Promise<OrganizationDirectMessage[]> => {
  const response = await client.get<OrganizationDirectMessage[]>(
    `/communications/organizations/${organizationId}/direct/${userId}`,
  );
  return response.data;
};

export const postOrgDirectMessage = async (
  organizationId: number,
  userId: number,
  body: string,
  attachmentUrl?: string,
  attachmentName?: string,
): Promise<OrganizationDirectMessage> => {
  const response = await client.post<OrganizationDirectMessage>(
    `/communications/organizations/${organizationId}/direct/${userId}`,
    { body, attachment_url: attachmentUrl ?? null, attachment_name: attachmentName ?? null },
  );
  return response.data;
};

export const uploadChatAttachment = async (
  organizationId: number,
  file: File,
): Promise<{ attachment_url: string; attachment_name: string }> => {
  const form = new FormData();
  form.append("file", file);
  const response = await client.post<{ attachment_url: string; attachment_name: string }>(
    `/communications/organizations/${organizationId}/attachment`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return response.data;
};

export const leaveOrganization = async (organizationId: number): Promise<{ status: string; detail: string }> => {
  const response = await client.delete<{ status: string; detail: string }>(`/users/organizations/${organizationId}/membership`);
  return response.data;
};

export const removeOrganizationMember = async (organizationId: number, userId: number): Promise<{ status: string; detail: string }> => {
  const response = await client.delete<{ status: string; detail: string }>(`/users/organizations/${organizationId}/members/${userId}`);
  return response.data;
};
