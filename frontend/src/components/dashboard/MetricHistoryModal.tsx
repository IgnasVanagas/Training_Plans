import { Box, Button, Modal, NumberInput, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { MetricKey } from "../../pages/dashboard/types";
import { metricDescriptions, metricModalTitle } from "../../pages/dashboard/utils";
import { useI18n } from "../../i18n/I18nProvider";

type MetricHistoryModalProps = {
  selectedMetric: MetricKey | null;
  onClose: () => void;
  manualMetricDate: Date | null;
  setManualMetricDate: (date: Date | null) => void;
  manualMetricValue: number | "";
  setManualMetricValue: (value: number | "") => void;
  saveDailyMetric: () => void;
  savingManualMetric: boolean;
  selectedMetricChartData: Array<Record<string, string | number | null>>;
  selectedMetricRows: Array<{ date: string; value: string | number | null }>;
};

export const MetricHistoryModal = ({
  selectedMetric,
  onClose,
  manualMetricDate,
  setManualMetricDate,
  manualMetricValue,
  setManualMetricValue,
  saveDailyMetric,
  savingManualMetric,
  selectedMetricChartData,
  selectedMetricRows,
}: MetricHistoryModalProps) => {
  const { language } = useI18n();
  const isLt = language === "lt";

  return (
    <Modal
      opened={Boolean(selectedMetric)}
      onClose={onClose}
      title={selectedMetric ? metricModalTitle[selectedMetric] : "Metric"}
      centered
      size="lg"
    >
      {selectedMetric && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{metricDescriptions[selectedMetric]}</Text>
          {(selectedMetric === "rhr" || selectedMetric === "hrv") && (
            <Paper withBorder p="sm" radius="sm">
              <Stack gap="xs">
                <Text size="sm" fw={600}>Add daily {selectedMetric === "hrv" ? "HRV" : "RHR"}</Text>
                <Box>
                  <DateInput
                    label="Date"
                    value={manualMetricDate}
                    onChange={setManualMetricDate}
                    clearable={false}
                  />
                </Box>
                <NumberInput
                  label={selectedMetric === "hrv" ? "HRV (ms)" : "RHR (bpm)"}
                  value={manualMetricValue}
                  onChange={(value) => setManualMetricValue(typeof value === "number" ? value : "")}
                  min={0}
                />
                <Button onClick={saveDailyMetric} loading={savingManualMetric}>Save Daily</Button>
              </Stack>
            </Paper>
          )}
          {selectedMetric === "training_status" && (
            <Paper withBorder p="sm" radius="sm">
              <Stack gap={4}>
                <Text size="sm" fw={600}>{isLt ? "TSB pagrįstos būsenos" : "TSB-based statuses (CTL − ATL)"}</Text>
                <Text size="sm"><b>{isLt ? "Formos kritimas" : "Detraining"}</b>{isLt ? ": CTL < 5; treniruočių stimulas nepakankamas." : ": CTL < 5; insufficient training stimulus."}</Text>
                <Text size="sm"><b>{isLt ? "Šviežia" : "Fresh"}</b>{isLt ? ": TSB > 15; gerai pailsėjęs, tačiau gali netekti formos." : ": TSB > 15; well rested but fitness may be tapering."}</Text>
                <Text size="sm"><b>{isLt ? "Produktyvu" : "Productive"}</b>{isLt ? ": 5 ≤ TSB ≤ 15; optimalus progreso langas." : ": 5 ≤ TSB ≤ 15; optimal adaptation window."}</Text>
                <Text size="sm"><b>{isLt ? "Palaikymas" : "Maintaining"}</b>{isLt ? ": −10 ≤ TSB < 5; subalansuotas krūvis." : ": −10 ≤ TSB < 5; balanced load."}</Text>
                <Text size="sm"><b>{isLt ? "Pavargęs" : "Fatigued"}</b>{isLt ? ": −25 ≤ TSB < −10; reikalingas papildomas poilsis." : ": −25 ≤ TSB < −10; additional recovery needed."}</Text>
                <Text size="sm"><b>{isLt ? "Perkrautas" : "Strained"}</b>{isLt ? ": TSB < −25; didelė traumų rizika." : ": TSB < −25; high injury risk."}</Text>
              </Stack>
            </Paper>
          )}
          <Title order={5}>History</Title>
          {selectedMetricChartData.length > 0 ? (
            <>
              <Box w="100%" h={280}>
                <ResponsiveContainer>
                  <LineChart data={selectedMetricChartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <RechartsTooltip
                      labelFormatter={(value, payload) => {
                        const first = payload?.[0]?.payload as { date?: string } | undefined;
                        return first?.date || String(value);
                      }}
                    />
                    {(selectedMetric === "aerobic_load" || selectedMetric === "anaerobic_load" || selectedMetric === "training_status") && <Legend />}

                    {(selectedMetric === "ftp" || selectedMetric === "rhr" || selectedMetric === "hrv") && (
                      <Line type="monotone" dataKey="value" stroke="#228be6" strokeWidth={2} dot={false} connectNulls />
                    )}

                    {selectedMetric === "aerobic_load" && (
                      <Line type="monotone" dataKey="atl" name="ATL" stroke="#E95A12" strokeWidth={2} dot={false} />
                    )}

                    {selectedMetric === "anaerobic_load" && (
                      <Line type="monotone" dataKey="ctl" name="CTL" stroke="#2563eb" strokeWidth={2} dot={false} />
                    )}

                    {selectedMetric === "training_status" && (
                      <>
                        <Line type="monotone" dataKey="atl" name="ATL" stroke="#E95A12" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="ctl" name="CTL" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="tsb" name="TSB" stroke="#9775fa" strokeWidth={2} dot={false} />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </Box>

              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Value</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {selectedMetricRows.map((row) => (
                    <Table.Tr key={`${selectedMetric}-${row.date}`}>
                      <Table.Td>{row.date}</Table.Td>
                      <Table.Td>{row.value ?? "-"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          ) : (
            <Text size="sm" c="dimmed">No history yet.</Text>
          )}
        </Stack>
      )}
    </Modal>
  );
};
