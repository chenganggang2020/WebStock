#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QStringList>
#include <QWidget>
#include <atomic>
#include <memory>
class QStackedWidget;
class DarkObservationPage;
class QDateEdit;
class QComboBox;
class QLineEdit;
class QCheckBox;
class QTableWidget;
class QLabel;
class QPushButton;
class QHideEvent;
class DarkStockPage final : public QWidget {
  Q_OBJECT
public:
  DarkStockPage(QString directory, bool allowNetwork,
                QWidget *parent = nullptr);
  ~DarkStockPage() override;
  void setSymbols(const QStringList &symbols);
  void load();
  void refreshSource();
  void cancel();
  bool closeObservation();
signals:
  void stockRequested(const QString &symbol);

protected:
  void hideEvent(QHideEvent *) override;

private:
  QStackedWidget *stack;
  DarkObservationPage *observations;
  QString directory;
  bool allowNetwork;
  quint64 generation = 0;
  int page = 0;
  QStringList symbols;
  std::shared_ptr<std::atomic_bool> cancelled =
      std::make_shared<std::atomic_bool>(false);
  QJsonObject snapshot;
  QJsonArray displayed;
  QString resultState;
  QDateEdit *date;
  QComboBox *rankMetric, *rankDirection;
  QLineEdit *search;
  QCheckBox *own;
  QTableWidget *table;
  QLabel *state, *detail, *pages;
  QPushButton *refresh, *back, *next;
  void run(bool network);
  void render();
};
