import { Box, Button, Modal, NumberInput, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { MetricKey } from "../../pages/dashboard/types";
import { metricDescriptions, metricModalTitle } from "../../pages/dashboard/utils";

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
                <Text size="sm" fw={600}>All possible statuses</Text>
                <Text size="sm"><b>Detraining</b>: very low recent and chronic load; fitness stimulus is likely insufficient.</Text>
                <Text size="sm"><b>Maintaining</b>: minimal baseline load with stable low strain.</Text>
                <Text size="sm"><b>Recovering</b>: acute load is well below chronic load ($ACWR &lt; 0.8$); useful after hard blocks.</Text>
                <Text size="sm"><b>Productive</b>: balanced progression zone ($0.8 \le ACWR \le 1.2$); best range for consistent adaptation.</Text>
                <Text size="sm"><b>Overreaching</b>: elevated short-term stress ($1.2 &lt; ACWR \le 1.5$); manageable if brief and planned.</Text>
                <Text size="sm"><b>Strained</b>: excessive short-term stress ($ACWR &gt; 1.5$); higher fatigue/injury risk.</Text>
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
                    {selectedMetric === "aerobic_load" && <Legend />}
                    {selectedMetric === "anaerobic_load" && <Legend />}
                    {selectedMetric === "training_status" && <Legend />}

                    {(selectedMetric === "ftp" || selectedMetric === "rhr" || selectedMetric === "hrv") && (
                      <Line type="monotone" dataKey="value" stroke="#228be6" strokeWidth={2} dot={false} connectNulls />
                    )}

                    {selectedMetric === "aerobic_load" && (
                      <Line type="monotone" dataKey="aerobic" name="Aerobic" stroke="#12b886" strokeWidth={2} dot={false} />
                    )}

                    {selectedMetric === "anaerobic_load" && (
                      <Line type="monotone" dataKey="anaerobic" name="Anaerobic" stroke="#fa5252" strokeWidth={2} dot={false} />
                    )}

                    {selectedMetric === "training_status" && (
                      <>
                        <Line type="monotone" dataKey="acute" name="Acute load" stroke="#228be6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="chronic" name="Chronic load" stroke="#9775fa" strokeWidth={2} dot={false} />
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
