#pragma once
#include <QButtonGroup>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMainWindow>
#include <QPushButton>
#include <QSettings>
#include <QSplitter>
#include <QTableWidget>
#include <QTabWidget>
#include <QHash>
#include <QTemporaryDir>
#include <QTextBrowser>
#include <memory>
namespace unifiedBackup {class AsyncLane;}
namespace industryTopicUpdate {class Runtime;}

#include "chart.hpp"
#include "market_feed.hpp"
#include "business_store.hpp"
namespace Ui {
class ReviewWindow;
}
class CollectionPipeline;
struct RotationSamplingHooks;
class EtfPage;
class RecentStore;
class QComboBox;
class QToolBar;
class WatchlistWorkspaceStore;
class Window final : public QMainWindow {
  Q_OBJECT
 public:
  explicit Window(bool testing = false, const QString& testSettingsFile = {},
                  const QString& dataDirectoryOverride = {});
  ~Window();
  Chart* chart;
  Chart* referenceChart;
  QListWidget* groups;
  QTableWidget* stocks;
  QLabel* quote;
  QTextBrowser* explanation;
  QString instrumentId() const { return activeId; }
  QString layoutMode() const { return mode; }
  void setLayoutMode(const QString& next);
  void setPeriod(const QString& next);
  void showExplanation(int index);

 protected:
  void closeEvent(QCloseEvent*) override;
  void resizeEvent(QResizeEvent*) override;
  void changeEvent(QEvent*) override;
  void keyPressEvent(QKeyEvent*) override;

 private:
  bool persistenceClosing=false,persistenceCloseReady=false;
  friend class IndustryTopicWindowTests;
  QString industryTopicDirectory() const;
  industryTopicUpdate::Runtime* ensureIndustryTopicRuntime();
  void industryTopicView();
  friend class UnifiedBackupHostTests;
  friend class PaperMonitorWindowTests;
  friend class RotationSamplingWindowTests;
  friend class DarkObservationWindowTests;
  friend class KnowledgeAiWindowTests;
  friend class CreatorAiWindowTests;
  friend class SectorAiWindowTests;
  RotationSamplingHooks* rotationTestHooks=nullptr;
  std::function<QString()> paperMonitorTestNow;
  friend class MigrationV34HostsTests;
  friend class MigrationV40HostTests;
  friend class VwapHostTests;
  friend class ChartAnnotationsWindowTests;
  friend class AuctionHostTests;
  friend class WatchlistHostTests;
  friend class EtfMonitorHostTests;
  friend class FuturesHostTests;
  friend class CffexHostTests;
  friend class CandidateBackgroundWindowTests;
  friend class AccountBackupHostTests;
  friend class AccountReferenceHostTests;
  friend class ArchiveVideoHostTests;
  void archiveVideoView(const QJsonObject& row);
  QNetworkAccessManager* futuresTestNetwork=nullptr;
  void futuresMonitorView();
  QNetworkAccessManager* cffexTestNetwork=nullptr;
  void cffexDisclosureView();void saveCffexDisclosureState();
  QString etfRefreshToken;
  void etfMonitorView();
  void refreshEtfMonitor(QString token,QJsonObject selection);
// Add forward declarations and private fields/methods in Window; no other field changes.
std::shared_ptr<WatchlistWorkspaceStore> watchlistGroupStore;
QJsonObject watchlistBridgeRawInputs() const;
QJsonObject watchlistInitPacket;
QString watchlistBridgeError;
bool watchlistViewRestoreFailed=false;
std::shared_ptr<WatchlistWorkspaceStore> watchlistBridgeStore(bool create=false);
QString watchlistBridgePath() const;
QJsonObject watchlistBridgeRead(QJsonObject inputs);
QJsonObject watchlistBridgeLegacyDirectory(const QString& requested) const;
QJsonObject watchlistBridgeCapture() const;
QJsonObject watchlistBridgeDirectory(const QString& requested=QString());
void renderWatchlistDirectory(const QString& requested=QString());
void watchlistWorkspaceView();
void unifiedBackupView();
std::shared_ptr<unifiedBackup::AsyncLane> unifiedBackupLane;
  void watchlistBackupExportPath(const QString&);void watchlistBackupImportPath(const QString&);
void watchlistReconciliationView();
void editWatchVisibility();
void watchlistBridgeSaveViews();
void watchlistBridgeRestoreViews();

  std::unique_ptr<Ui::ReviewWindow> ui;
  QJsonArray instruments;
  QJsonObject instrument;
  QString activeId, mode = "classic", period = "day";
  QWidget *groupPanel = nullptr, *stockPanel = nullptr, *signalPanel = nullptr,
          *centerPanel = nullptr;
  QSplitter* charts = nullptr;
  QLineEdit* search;
  QLabel* context;
  QLabel *snapshot, *signalSummary, *chartReadout, *marketStrip = nullptr;
  QLabel *footerSummary = nullptr, *bookState = nullptr;
  QWidget *focusFooter = nullptr, *indicatorRow = nullptr;
  QWidget* indicatorChoices = nullptr;
  QComboBox* indicatorSelector = nullptr;
  QPushButton *dualButton = nullptr, *openChartButton = nullptr;
  bool dualCharts = false;
  QButtonGroup *periodButtons, *indicatorButtons, *layoutButtons;
  QPushButton* activeWorkspace = nullptr;
  QTabWidget* workspaceTabs = nullptr;
  QHash<QString, QWidget*> pages;
  QWidget* moduleNavigation=nullptr;
  QToolBar* navigationToolbar=nullptr;
  QHash<QString,QAction*> navigationActions;
  QJsonObject navigationPreferences;
  QByteArray navigationFileBytes;
  QString navigationFileError;
  void setupNavigation();
  void syncNavigation();
  void openNavigation(const QString& id);
  void navigationSettingsView();
  QString navigationFilePath() const;
  void readNavigationPreferences();
  void legacyArchiveView();
  std::shared_ptr<BusinessStore> businessStore;
  std::shared_ptr<RecentStore> recentStore;
  CollectionPipeline* collectionPipeline=nullptr;
  EtfPage* etfUpdater=nullptr;
  std::unique_ptr<QTemporaryDir> businessTestDirectory;
  void auctionAnalysisView();
  QJsonArray auctionAnalysisSnapshots() const;
  void reloadAuctionHistory();
  QJsonArray auctionHistorySnapshots;
  bool auctionHistoryLoaded=false,auctionHistoryBusy=false;
  void paperMonitorView();
  void accountView(bool paper=false);
  void accountEditView();void saveAccountEditView();bool accountEditStateFailed=false;
  void accountReferenceView(const QString& id={});QJsonObject accountReferenceOutput(const QString&) const;
  void portfolioMirrorView(const QString& account={});
  QJsonObject portfolioMirrorInputs() const;
  void recentView();
  void recordViewedInstrument();
  void openRecentInstrument(const QString& id, bool analysis);
  void researchView();
  void stockResearchView(bool selectCurrent = true);
  void securitiesSearchAction(QWidget* origin, const QJsonObject&, const QString&);
  void businessSearchView();
  void securitiesDirectoryView();
  void personMethodView();
  void evidenceReviewView();
  void riskSettingsView();
  void dataSafetyView();
  void migrationStatusView();
  void aiSettingsView();
  void materialLibraryView();
  void knowledgeAiHostView();
  QJsonArray materialLibrarySources() const;
  void dataSourceStatusView();
  QJsonObject dataSourceEvidence() const;
  QJsonObject dataSourceEvidenceInput() const;
  void openDataSourceTarget(const QString&,const QJsonObject&);
  bool sourceEvidenceNavigation=false;
  QJsonObject migrationSnapshot() const;
  QString migrationTarget(const QString&,const QString&) const;
  void openMigrationTarget(const QString&,const QString&);
  void marketOverviewView();
  void industryDiscoveryView();
  void quantResearchView();
  void prepareQuantResearch(bool activate);
  void sectorResearchView(const QString& kind={},const QString& id={});
  QJsonArray sectorResearchScopes() const;
  QJsonArray dataSafetyInventory() const;
  QJsonObject riskInputs() const;
  void openRiskInstrument(const QJsonObject&);
  QJsonArray evidenceInstruments() const;
  void evidenceInstrumentAction(const QString&, const QJsonObject&);
  QJsonArray personMethodVersions() const;
  void openPersonMethodSource(const QJsonObject&);
  bool closeInternalReader();
  void newsView(bool selectCurrent = false);
  void researchHistoryView(const QString& title);
  void openHandoffSource(const QString& kind, const QJsonObject& expected);
  void openResearchDocument(const QJsonObject& expected);
  void localCandidateView();
  void marketComparisonView();
  void globalMarketView();
  void publicPriceDetailView();
  void sectorWatchView();
  void sectorLeadersView();
  void scenarioToolsView();
  void collectionView();
  void settingsView();
  QWidget* businessPage(const QString& key, const QString& title, const QString& workspace);
  void activatePage(QWidget* page);
  void home();
  Chart* inspectedChart = nullptr;
  bool testing, dark = true;
  QString themeId = "navy";
  void selectTheme(const QString&);
  int samplingSeconds = 0;
  MarketFeed* feed = nullptr;
  bool livePanePending=false,liveQuoteRefresh=false;
  QLabel *dataState = nullptr, *bookRows = nullptr;
  std::unique_ptr<QSettings> settings;
  void fillStocks();
  void loadInstrument(const QString& id, bool reset = true);
  void loadChart(Chart*, const QString&, bool);
  void parameters();
  void selectIndicator(const QString& name);
  void funds();
  void rotation();
  void etfDailyView();
  void darkStockView();
  void auctionView();
  void editGroups();
  void applyTheme();
  void arrangeWorkspace();
  void explainChart(Chart* source, int index);
  void save();
  void syncLive(bool rosterChanged = false);
  void refreshLive();
  QPushButton* button(const QString&, const QString&,
                      QWidget* parent = nullptr);
  industryTopicUpdate::Runtime* industryTopicRuntime=nullptr;
  friend class LegacyHighFrequencyWindowTests;
  void legacyHighFrequencyView();
  void openLegacyHistoryPacket(QJsonObject packet);
  QJsonObject legacyHighFrequencyFrame,legacyHighFrequencyReturnState;
  QPushButton* legacyHighFrequencyReturnButton=nullptr;
};
