import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { SectionTotal } from '@/lib/rate-engine';

// PPG Brand colors
const COLORS = {
  navy: '#0F1F3D',
  blue: '#1D6CE0',
  amber: '#F59E0B',
  white: '#FFFFFF',
  lightGray: '#F1F5F9',
  borderGray: '#E2E8F0',
  textGray: '#475569',
  textDark: '#0F172A',
};

function fmt(n: number) {
  return '$' + n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export interface EstimateDocumentProps {
  project: { name: string; client: string | null };
  sections: SectionTotal[];
  totals: { subtotal: number; margin: number; grandTotal: number };
  marginPercent: number;
  generatedAt: string;
}

const styles = StyleSheet.create({
  coverPage: {
    backgroundColor: COLORS.navy,
    padding: 50,
    color: COLORS.white,
    flexDirection: 'column',
    justifyContent: 'space-between',
    height: '100%',
  },
  coverTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  coverLogo: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 36,
    color: COLORS.white,
    letterSpacing: 2,
  },
  estimateLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    color: COLORS.amber,
    letterSpacing: 6,
  },
  coverCenter: {
    flexDirection: 'column',
  },
  coverProjectLabel: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: COLORS.amber,
    letterSpacing: 2,
    marginBottom: 8,
  },
  coverProjectName: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 36,
    color: COLORS.white,
    marginBottom: 12,
  },
  coverClient: {
    fontFamily: 'Helvetica',
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.85,
  },
  coverBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: COLORS.blue,
    paddingTop: 18,
  },
  coverPreparedBy: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: COLORS.white,
  },
  coverPreparedSub: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.white,
    opacity: 0.7,
    marginTop: 2,
  },
  coverDate: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.white,
    opacity: 0.85,
    textAlign: 'right',
  },

  // Summary & Detail pages
  page: {
    padding: 32,
    backgroundColor: COLORS.white,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.textDark,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: COLORS.navy,
    paddingBottom: 8,
    marginBottom: 14,
  },
  headerTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 16,
    color: COLORS.navy,
  },
  headerMeta: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.textGray,
  },
  projectMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  metaBlock: {
    flexDirection: 'column',
  },
  metaLabel: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: COLORS.textGray,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  metaValue: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: COLORS.textDark,
    marginTop: 2,
  },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.navy,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tableHeaderCell: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: COLORS.white,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderGray,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRowAlt: {
    backgroundColor: COLORS.lightGray,
  },
  tableCell: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.textDark,
  },

  summaryFooterRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightGray,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.navy,
  },
  grandTotalRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.navy,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginTop: 2,
  },
  grandTotalCell: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: COLORS.white,
  },

  sectionBanner: {
    backgroundColor: COLORS.blue,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionBannerTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    color: COLORS.white,
  },
  sectionBannerSub: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.white,
    opacity: 0.85,
  },

  sectionTotalRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.navy,
    paddingVertical: 7,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  sectionTotalCell: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: COLORS.white,
  },

  footer: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: COLORS.textGray,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.borderGray,
    paddingTop: 6,
  },
});

// Flex values for summary table columns
const SUM_FLEX = {
  num: 0.5,
  name: 3,
  labour: 1.2,
  material: 1.2,
  plant: 1,
  subtotal: 1.2,
  margin: 1.2,
  grand: 1.4,
};

// Flex values for detail table columns
const DET_FLEX = {
  description: 4,
  uom: 0.8,
  labourRate: 1,
  materialRate: 1,
  plantRate: 1,
  qty: 1,
  subtotal: 1.3,
};

function CoverPage({ project, generatedAt }: { project: EstimateDocumentProps['project']; generatedAt: string }) {
  return (
    <Page size="A4" style={styles.coverPage}>
      <View style={styles.coverTop}>
        <Text style={styles.coverLogo}>PPG</Text>
        <Text style={styles.estimateLabel}>ESTIMATE</Text>
      </View>

      <View style={styles.coverCenter}>
        <Text style={styles.coverProjectLabel}>PROJECT</Text>
        <Text style={styles.coverProjectName}>{project.name}</Text>
        <Text style={styles.coverClient}>{project.client || 'Client: TBC'}</Text>
      </View>

      <View style={styles.coverBottom}>
        <View>
          <Text style={styles.coverPreparedBy}>Prepared by Prime Plumbing Group</Text>
          <Text style={styles.coverPreparedSub}>Confidential — for intended recipient only</Text>
        </View>
        <Text style={styles.coverDate}>Issued: {formatDate(generatedAt)}</Text>
      </View>
    </Page>
  );
}

function SummaryPage({
  project,
  sections,
  totals,
  marginPercent,
  generatedAt,
}: EstimateDocumentProps) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.pageHeader}>
        <Text style={styles.headerTitle}>Estimate Summary</Text>
        <Text style={styles.headerMeta}>Prime Plumbing Group — {formatDate(generatedAt)}</Text>
      </View>

      <View style={styles.projectMeta}>
        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>Project</Text>
          <Text style={styles.metaValue}>{project.name}</Text>
        </View>
        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>Client</Text>
          <Text style={styles.metaValue}>{project.client || 'TBC'}</Text>
        </View>
        <View style={styles.metaBlock}>
          <Text style={styles.metaLabel}>Margin Applied</Text>
          <Text style={styles.metaValue}>{marginPercent}%</Text>
        </View>
      </View>

      {/* Table Header */}
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.num }]}>#</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.name }]}>Section</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.labour, textAlign: 'right' }]}>Labour</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.material, textAlign: 'right' }]}>Material</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.plant, textAlign: 'right' }]}>Plant</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.subtotal, textAlign: 'right' }]}>Subtotal</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.margin, textAlign: 'right' }]}>Margin</Text>
        <Text style={[styles.tableHeaderCell, { flex: SUM_FLEX.grand, textAlign: 'right' }]}>Grand Total</Text>
      </View>

      {/* Rows */}
      {sections.map((s, idx) => {
        const sectionMargin = s.total * (marginPercent / 100);
        const sectionGrand = s.total + sectionMargin;
        return (
          <View
            key={s.sectionNumber}
            wrap={false}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
          >
            <Text style={[styles.tableCell, { flex: SUM_FLEX.num }]}>{s.sectionNumber}</Text>
            <Text style={[styles.tableCell, { flex: SUM_FLEX.name }]}>{s.sectionName}</Text>
            <Text style={[styles.tableCell, { flex: SUM_FLEX.labour, textAlign: 'right' }]}>{fmt(s.labour)}</Text>
            <Text style={[styles.tableCell, { flex: SUM_FLEX.material, textAlign: 'right' }]}>{fmt(s.material)}</Text>
            <Text style={[styles.tableCell, { flex: SUM_FLEX.plant, textAlign: 'right' }]}>{fmt(s.plant)}</Text>
            <Text style={[styles.tableCell, { flex: SUM_FLEX.subtotal, textAlign: 'right' }]}>{fmt(s.total)}</Text>
            <Text style={[styles.tableCell, { flex: SUM_FLEX.margin, textAlign: 'right' }]}>{fmt(sectionMargin)}</Text>
            <Text
              style={[
                styles.tableCell,
                { flex: SUM_FLEX.grand, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
              ]}
            >
              {fmt(sectionGrand)}
            </Text>
          </View>
        );
      })}

      {/* Subtotal / Margin row */}
      <View style={styles.summaryFooterRow} wrap={false}>
        <Text style={[styles.tableCell, { flex: SUM_FLEX.num + SUM_FLEX.name, fontFamily: 'Helvetica-Bold' }]}>
          Subtotal
        </Text>
        <Text style={[styles.tableCell, { flex: SUM_FLEX.labour, textAlign: 'right' }]} />
        <Text style={[styles.tableCell, { flex: SUM_FLEX.material, textAlign: 'right' }]} />
        <Text style={[styles.tableCell, { flex: SUM_FLEX.plant, textAlign: 'right' }]} />
        <Text
          style={[
            styles.tableCell,
            { flex: SUM_FLEX.subtotal, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
          ]}
        >
          {fmt(totals.subtotal)}
        </Text>
        <Text
          style={[
            styles.tableCell,
            { flex: SUM_FLEX.margin, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
          ]}
        >
          {fmt(totals.margin)}
        </Text>
        <Text
          style={[
            styles.tableCell,
            { flex: SUM_FLEX.grand, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
          ]}
        >
          {fmt(totals.grandTotal)}
        </Text>
      </View>

      {/* Grand Total row */}
      <View style={styles.grandTotalRow} wrap={false}>
        <Text style={[styles.grandTotalCell, { flex: SUM_FLEX.num + SUM_FLEX.name }]}>GRAND TOTAL (inc. Margin)</Text>
        <Text
          style={[
            styles.grandTotalCell,
            {
              flex:
                SUM_FLEX.labour +
                SUM_FLEX.material +
                SUM_FLEX.plant +
                SUM_FLEX.subtotal +
                SUM_FLEX.margin +
                SUM_FLEX.grand,
              textAlign: 'right',
            },
          ]}
        >
          {fmt(totals.grandTotal)}
        </Text>
      </View>

      <View style={styles.footer} fixed>
        <Text>Prime Plumbing Group — Estimate for {project.name}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

function SectionDetailPage({
  section,
  project,
  generatedAt,
  marginPercent,
}: {
  section: SectionTotal;
  project: EstimateDocumentProps['project'];
  generatedAt: string;
  marginPercent: number;
}) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.pageHeader}>
        <Text style={styles.headerTitle}>{project.name}</Text>
        <Text style={styles.headerMeta}>Prime Plumbing Group — {formatDate(generatedAt)}</Text>
      </View>

      <View style={styles.sectionBanner}>
        <Text style={styles.sectionBannerTitle}>
          {section.sectionNumber}. {section.sectionName}
        </Text>
        <Text style={styles.sectionBannerSub}>{section.items.length} {section.items.length === 1 ? 'line item' : 'line items'}</Text>
      </View>

      {/* Detail Table Header */}
      <View style={styles.tableHeader} fixed>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.description }]}>Description</Text>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.uom }]}>UOM</Text>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.labourRate, textAlign: 'right' }]}>L/hr</Text>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.materialRate, textAlign: 'right' }]}>M/unit</Text>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.plantRate, textAlign: 'right' }]}>P/hr</Text>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.qty, textAlign: 'right' }]}>Qty</Text>
        <Text style={[styles.tableHeaderCell, { flex: DET_FLEX.subtotal, textAlign: 'right' }]}>Sub Total</Text>
      </View>

      {section.items.map((item, idx) => {
        const labourRate = item.labour_rate || 0;
        const materialRate = item.material_rate || 0;
        const plantRate = item.plant_rate || 0;
        const qty = item.final_qty || 0;
        const subTotal = qty * (labourRate + materialRate + plantRate);
        return (
          <View
            key={idx}
            wrap={false}
            style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
          >
            <Text style={[styles.tableCell, { flex: DET_FLEX.description }]}>{item.description}</Text>
            <Text style={[styles.tableCell, { flex: DET_FLEX.uom }]}>{item.uom}</Text>
            <Text style={[styles.tableCell, { flex: DET_FLEX.labourRate, textAlign: 'right' }]}>{fmt(labourRate)}</Text>
            <Text style={[styles.tableCell, { flex: DET_FLEX.materialRate, textAlign: 'right' }]}>{fmt(materialRate)}</Text>
            <Text style={[styles.tableCell, { flex: DET_FLEX.plantRate, textAlign: 'right' }]}>{fmt(plantRate)}</Text>
            <Text style={[styles.tableCell, { flex: DET_FLEX.qty, textAlign: 'right' }]}>{qty.toFixed(2)}</Text>
            <Text
              style={[
                styles.tableCell,
                { flex: DET_FLEX.subtotal, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
              ]}
            >
              {fmt(subTotal)}
            </Text>
          </View>
        );
      })}

      {/* Section total */}
      <View style={styles.sectionTotalRow} wrap={false}>
        <Text
          style={[
            styles.sectionTotalCell,
            {
              flex:
                DET_FLEX.description +
                DET_FLEX.uom +
                DET_FLEX.labourRate +
                DET_FLEX.materialRate +
                DET_FLEX.plantRate +
                DET_FLEX.qty,
            },
          ]}
        >
          Section Total (Labour {fmt(section.labour)} · Material {fmt(section.material)} · Plant {fmt(section.plant)})
        </Text>
        <Text
          style={[
            styles.sectionTotalCell,
            { flex: DET_FLEX.subtotal, textAlign: 'right' },
          ]}
        >
          {fmt(section.total)}
        </Text>
      </View>

      <View style={styles.footer} fixed>
        <Text>
          Prime Plumbing Group — {project.name} · Margin {marginPercent}%
        </Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

export default function EstimateDocument(props: EstimateDocumentProps) {
  const { project, sections, totals, marginPercent, generatedAt } = props;
  return (
    <Document
      title={`Estimate - ${project.name}`}
      author="Prime Plumbing Group"
      subject="Project Estimate"
    >
      <CoverPage project={project} generatedAt={generatedAt} />
      <SummaryPage
        project={project}
        sections={sections}
        totals={totals}
        marginPercent={marginPercent}
        generatedAt={generatedAt}
      />
      {sections.map((section) => (
        <SectionDetailPage
          key={section.sectionNumber}
          section={section}
          project={project}
          generatedAt={generatedAt}
          marginPercent={marginPercent}
        />
      ))}
    </Document>
  );
}
