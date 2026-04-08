import { ActionIcon, Avatar, Box, Button, Group, LoadingOverlay, Paper, ScrollArea, Stack, Text, Textarea, Title, useMantineTheme } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconSend } from "@tabler/icons-react";
import { useState } from "react";
import { addThreadComment, getThread } from "../../api/communications";
import { formatDistanceToNow } from "date-fns";
import { enUS, lt as ltLocale } from "date-fns/locale";
import { useI18n } from "../../i18n/I18nProvider";

interface CommentsPanelProps {
    entityType: "activity" | "workout";
    entityId: number;
    athleteId?: number; // Needed if coach is viewing athlete's data
}

export const CommentsPanel = ({ entityType, entityId, athleteId }: CommentsPanelProps) => {
    const theme = useMantineTheme();
    const queryClient = useQueryClient();
    const [newComment, setNewComment] = useState("");
    const { language, t } = useI18n();
    const relativeTimeLocale = language === "lt" ? ltLocale : enUS;

    const { data: thread, isLoading } = useQuery({
        queryKey: ["thread", entityType, entityId],
        queryFn: () => getThread(entityType, entityId, athleteId),
        // If 404/empty, the API returns a structure with empty comments array, so it's fine.
    });

    const addCommentMutation = useMutation({
        mutationFn: (body: string) => addThreadComment(entityType, entityId, body, athleteId),
        onSuccess: (newComment) => {
            setNewComment("");
            queryClient.invalidateQueries({ queryKey: ["thread", entityType, entityId] });
            // Ideally we optimistically update or append the new comment
        }
    });

    const handleSend = () => {
        if (!newComment.trim()) return;
        addCommentMutation.mutate(newComment);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <Paper withBorder p="md" radius="lg" h="100%" display="flex" style={{ flexDirection: "column" }}>
            <Title order={5} mb="sm">{t("Comments")}</Title>
            
            <Box style={{ flex: 1, position: "relative" }}>
                <LoadingOverlay visible={isLoading} />
                <ScrollArea h={300} type="always" offsetScrollbars>
                    <Stack gap="md" pr="xs">
                        {thread?.comments.length === 0 && (
                            <Text c="dimmed" fs="italic" size="sm">{t("No comments yet.")}</Text>
                        )}
                        {thread?.comments.map((comment) => (
                            <Group key={comment.id} align="flex-start" wrap="nowrap">
                                <Avatar radius="xl" color={comment.author_role === "coach" ? "teal" : "blue"}>
                                    {comment.author_role === "coach" ? "C" : "A"}
                                </Avatar>
                                <Paper withBorder p="xs" radius="md" bg={theme.colors.gray[0]} style={{ flex: 1 }}>
                                    <Group justify="space-between" mb={4}>
                                        <Text size="xs" fw={700} c={comment.author_role === "coach" ? "teal" : "blue"}>
                                            {comment.author_role === "coach" ? t("Coach") : t("Athlete")}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: relativeTimeLocale })}
                                        </Text>
                                    </Group>
                                    <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{comment.body}</Text>
                                </Paper>
                            </Group>
                        ))}
                    </Stack>
                </ScrollArea>
            </Box>

            <Group align="flex-end" mt="md" gap="xs">
                <Textarea
                    placeholder={t("Write a comment...")}
                    autosize
                    minRows={1}
                    maxRows={4}
                    style={{ flex: 1 }}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <ActionIcon 
                    variant="filled" 
                    color={theme.primaryColor} 
                    size="lg" 
                    radius="md"
                    onClick={handleSend}
                    loading={addCommentMutation.isPending}
                    disabled={!newComment.trim()}
                >
                    <IconSend size={18} />
                </ActionIcon>
            </Group>
        </Paper>
    );
};
