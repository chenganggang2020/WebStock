#pragma once
#include <QJsonObject>
#include <QUrl>
#include <QWidget>
#include <memory>

// External platform login/visible-page reader only; never hosts native business
// UI.
class SourceBrowser : public QWidget {
  Q_OBJECT
 public:
  explicit SourceBrowser(QWidget* parent = nullptr);
  ~SourceBrowser() override;
  static bool allowed(const QUrl&);
  virtual void initialize(const QString& privateProfile);
  virtual void navigate(const QUrl&);
  virtual void capture();
  virtual void stop();
  virtual QUrl source() const;
  void setCollectionActive(bool active);
  bool collectionActive() const;
 signals:
  void ready();
  void loaded(QUrl url, bool success);
  void snapshot(QJsonObject page);
  void failure(QString message);

 protected:
  void resizeEvent(QResizeEvent*) override;
  void showEvent(QShowEvent*) override;
  void hideEvent(QHideEvent*) override;

 private:
  struct State;
  std::unique_ptr<State> state;
  void attach(void* controller);
  void syncPresentation();
};
