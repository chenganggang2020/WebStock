#pragma once
#include <QWidget>
#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QPointer>
#include <QThreadPool>
#include <QMap>
#include <QElapsedTimer>
#include <QDateTime>
#include <functional>
#include <atomic>
#include <memory>
class QComboBox;class QDateEdit;class QTableWidget;class QLabel;class QSlider;class QPushButton;class QNetworkReply;class QLineEdit;class RotationCurve;class QTimer;
struct RotationSamplingHooks {
 std::function<QDateTime()> now;
 std::function<qint64()> elapsed;
 std::function<void(QString,QString,int,std::function<void(QJsonObject,QString)>)> page;
 std::function<bool()> foreground;
};
class RotationPage final:public QWidget {
 Q_OBJECT
 public:
  RotationPage(QString file,bool allowNetwork,QWidget* parent=nullptr,RotationSamplingHooks hooks={},QString evidenceDirectory={});
  ~RotationPage() override;
  void importArchive(const QString& path);
  void exportArchive(const QString& path);
  void load();
  void refreshSource();
 private slots:
  void sampleDue();
 protected:
  void hideEvent(QHideEvent*) override;
 private:
  QString file,evidenceDirectory;bool allowNetwork;quint64 generation=0;
  QNetworkAccessManager network;QPointer<QNetworkReply> reply;
  std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
  QComboBox *scope,*kind,*metric,*minutes,*rank;QDateEdit* date;QLineEdit* search;RotationCurve* curve;
  QJsonObject analysis;QString baseStatus;quint64 analysisGeneration=0;
  std::shared_ptr<std::atomic_bool> analysisCancelled=std::make_shared<std::atomic_bool>(false);
  QTableWidget *table,*history;QLabel *state,*detail;QSlider* cursor;QPushButton *refresh,*cancel;
  QJsonArray snapshots,scanRows;QJsonObject scanBase;QMap<QString,qint64> attempts;
  QString scanDate,scanScope,scanStart;bool scanDaily=true;int scanPage=0,scanTotal=0;
  RotationSamplingHooks hooks;QElapsedTimer elapsed;
  QTimer* samplingTimer;QLabel* samplingState;QPushButton *samplingStart,*samplingStop;
  bool sampling=false,scanBusy=false,savePending=false;QJsonArray roundSnapshots;
  QString roundStart; qint64 nextDue=0,roundMonotonic=0;
  bool foreground()const;bool sessionAllowed(const QString& start,const QString& end)const;
  QDateTime now() const; qint64 monotonic() const;
  void startSampling();void receivePage(quint64 token,const QJsonObject& raw,const QString& error);
  void render();void draw();void selected();void stop();void nextPage(quint64 token);
  void fail(const QString& message);
  void discoverDate();
};
