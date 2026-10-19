#pragma once
#include <QWidget>
#include <memory>
#include "recent_store.hpp"
class QLabel;
class QLineEdit;
class QComboBox;
class QTableWidget;
class QPushButton;
class QTextEdit;
class RecentPage final : public QWidget {
  Q_OBJECT
 public:
  explicit RecentPage(std::shared_ptr<RecentStore> store, QWidget* parent = nullptr);
  void reload();
  void applyQuotes(const QJsonArray& instruments);
  void previewLegacy(const QString& path);
  void confirmLegacy();
  void exportCsv(const QString& path);
 signals:
  void openRequested(QString id, bool analysis);
  void watchlistRequested(QJsonObject instrument);
  void ledgerRequested(QJsonObject instrument);
  void refreshQuotesRequested();
  void backupRestoreRequested();
 private:
  std::shared_ptr<RecentStore> store;
  QJsonArray visibleRows, pending;
  QLabel *state = nullptr, *summary = nullptr, *previewSummary = nullptr;
  QTextEdit* originalDetails = nullptr;
  QPushButton *originalPrevious = nullptr,*originalNext = nullptr;
  QString originalText,originalSelection;
  int originalOffset = 0;
  QLineEdit* search = nullptr;
  QComboBox* sort = nullptr;
  QTableWidget *table = nullptr, *preview = nullptr;
  QWidget *clearConfirmation = nullptr, *importPanel = nullptr;
  QPushButton *open = nullptr, *analysis = nullptr, *watchlist = nullptr, *ledger = nullptr, *remove = nullptr;
  QJsonObject selected() const;
  void selectionChanged();
  void renderOriginal();
};
