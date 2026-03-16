import client from "./client";

export type CommunicationCommentOut = {
  id: number;
  thread_id: number;
  author_id: number;
  author_role: string;
  body: string;
  created_at: string;
};

export type CommunicationThreadOut = {
  id: number;
  entity_type: string;
  entity_id: number;
  athlete_id: number;
  coach_id?: number | null;
  comments: CommunicationCommentOut[];
};

export type CommunicationAcknowledgementOut = {
  id: number;
  entity_type: string;
  entity_id: number;
  athlete_id: number;
  actor_id: number;
  action: string;
  note?: string | null;
  created_at: string;
};

export type CommunicationAcknowledgementCreate = {
  entity_type: "activity" | "workout";
  entity_id: number;
  athlete_id?: number;
  action: string;
  note?: string;
};

export type CommunicationCommentCreate = {
  body: string;
  athlete_id?: number;
};

export type NotificationItemOut = {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  entity_type?: string;
  entity_id?: number;
  organization_id?: number;
  athlete_id?: number;
  status?: string;
};

export type NotificationsFeedOut = {
  items: NotificationItemOut[];
};

export type SupportRequestCreate = {
  name?: string;
  email: string;
  subject?: string;
  message: string;
  page_url?: string;
  error_message?: string;
  bot_trap?: string;
  client_elapsed_ms: number;
};

export type SupportRequestResponse = {
  message: string;
};

export const getThread = async (entityType: string, entityId: number | string, athleteId?: number) => {
  const params = athleteId ? { athlete_id: athleteId } : undefined;
  const response = await client.get<CommunicationThreadOut>(
    `/communications/threads/${entityType}/${entityId}`,
    { params }
  );
  return response.data;
};

export const addThreadComment = async (
  entityType: string,
  entityId: number | string,
  body: string,
  athleteId?: number
) => {
  const response = await client.post<CommunicationCommentOut>(
    `/communications/threads/${entityType}/${entityId}/comments`,
    { body, athlete_id: athleteId }
  );
  return response.data;
};

export const addAcknowledgement = async (payload: CommunicationAcknowledgementCreate) => {
  const response = await client.post<CommunicationAcknowledgementOut>(
    "/communications/acknowledgements",
    payload
  );
  return response.data;
};

export const getNotificationsFeed = async (limit: number = 40) => {
  const response = await client.get<NotificationsFeedOut>("/communications/notifications", {
    params: { limit },
  });
  return response.data;
};

export const getAcknowledgements = async (entityType: string, entityId: number | string) => {
  const response = await client.get<CommunicationAcknowledgementOut[]>(
    `/communications/acknowledgements/${entityType}/${entityId}`
  );
  return response.data;
};

export const getCommunicationHistory = async (athleteId: number, limit: number = 100) => {
  const response = await client.get<CommunicationAcknowledgementOut[]>(
    `/communications/history/${athleteId}`,
    { params: { limit } }
  );
  return response.data;
};

export const sendSupportRequest = async (payload: SupportRequestCreate) => {
  const response = await client.post<SupportRequestResponse>("/communications/support", payload);
  return response.data;
};
