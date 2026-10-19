#pragma once
#include "dark_observation.hpp"
#include <QWidget>
#include <atomic>
#include <memory>
class QLineEdit;
class QLabel;
class QPushButton;
class QTableWidget;
class QComboBox;
class QPlainTextEdit;
class QHideEvent;
class DarkObservationPage final : public QWidget {
  Q_OBJECT
public:
  explicit DarkObservationPage(QString directory, QWidget *parent = nullptr);
  ~DarkObservationPage() override;
  void openCaptured(QJsonObject snapshot, QString key, QString day);
  void cancel();
signals:
  void backRequested();

protected:
  void hideEvent(QHideEvent *) override;

private:
  QString directory;
  QJsonObject captured;
  QJsonArray points;
  std::shared_ptr<const darkObservation::Prepared> pending;
  QString revision;
  quint64 generation = 0;
  std::shared_ptr<std::atomic_bool> cancelled =
      std::make_shared<std::atomic_bool>(false);
  QLineEdit *key, *day;
  QLabel *status, *comparison;
  QPushButton *preview, *confirm, *read;
  QTableWidget *table;
  QComboBox *from, *to;
  QPlainTextEdit *detail;
  bool activePage() const;
  void busy(bool value);
  void prepare();
  void append();
  void load();
  void render(QJsonObject history);
  void showComparison();
};
