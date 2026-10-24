#pragma once
#include "quant_plugin_host.hpp"
#include <QPointer>
#include <QWidget>
#include <QMap>
class Chart;class CompactActions;class QVBoxLayout;class QMenu;class QPushButton;
class QComboBox;class QDateEdit;class QLabel;class QCheckBox;class QTabWidget;
class ExtensionPlot;class QDialog;

class StockExtensionPanel final:public QWidget {
  Q_OBJECT
  quantPlugin::Repository repository_;
  quantPlugin::Job job_;
  QPointer<Chart> chart_;
  QString id_,contextKey_,runKey_,runId_;
  QJsonObject manifest_,context_,result_,runQuery_,runParameters_;
  QMap<QString,QWidget*> fields_;
  QComboBox* operations_;
  QDateEdit *start_,*end_;
  QLabel *status_,*dataLabel_,*inspection_,*legend_;
  QPushButton *run_,*cancel_,*report_,*history_;
  QCheckBox *lines_,*marks_;
  QWidget *form_,*metrics_;
  QVBoxLayout* metricLayout_;
  QTabWidget* results_;
  bool changing_=false;
  QJsonObject operation()const;
  void parameters();void run();void completed();void render();void layers();void clearResult();void availability();
  void showDetails();void showHistory();void inspect(int index);
  void guard(std::function<void()> action);
public:
  StockExtensionPanel(QString root,QString id,Chart* chart,QWidget* parent=nullptr);
  ~StockExtensionPanel()override;
  void setContext(const QJsonObject& input);
  bool isRunning()const{return job_.active();}
signals:
  void refreshRequested();
};

class StockExtensionHost final:public QObject {
  Q_OBJECT
  struct Contribution { QPointer<QPushButton> button;QPointer<StockExtensionPanel> panel;QString signature; };
  quantPlugin::Repository repository_;
  QPointer<Chart> chart_;
  CompactActions* tools_;
  QVBoxLayout* panels_;
  QMap<QString,Contribution> contributions_;
  QJsonObject context_;
  QString offers_;
  QPointer<QDialog> manager_;
  void stop(const QString& id);
public:
  StockExtensionHost(QString root,Chart* chart,CompactActions* tools,QVBoxLayout* panels,QObject* parent);
  ~StockExtensionHost()override;
  void setContext(const QJsonObject& input);
  void synchronize();
  void open(const QString& id);
  void showManager();
  void install(const QByteArray& package);
  void setEnabled(const QString& id,bool enabled);
  void uninstall(const QString& id,bool keepHistory=true);
  QString root()const{return repository_.root();}
signals:
  void dayRequested();
  void refreshRequested();
  void changed();
  void error(QString message);
};
