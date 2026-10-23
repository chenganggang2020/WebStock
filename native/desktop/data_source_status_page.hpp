#pragma once
#include "data_source_status_model.hpp"
#include <QWidget>
#include <functional>
class PageSnapshotReader;
class QComboBox;class QLineEdit;class QListWidget;class QPlainTextEdit;class QLabel;class QPushButton;
class DataSourceStatusPage:public QWidget{
 Q_OBJECT
 QJsonObject current=dataSourceStatus::empty();QStringList allowed;QString selected;int page=0;bool updating=false;
 PageSnapshotReader* snapshotReader=nullptr;
 QComboBox *provider,*product,*granularity,*acquisition;QLineEdit* search;QListWidget* list;QPlainTextEdit *detail,*raw;QLabel *message,*pageLabel;QPushButton *open,*previous,*next;
 QJsonObject filters()const;QJsonObject selectedRecord()const;void refresh(bool reset=false);void showSelected();void options();
public:
 explicit DataSourceStatusPage(QWidget* parent=nullptr);
 void setSnapshot(const QJsonObject&);void setAllowedRoutes(const QStringList&);
 void requestSnapshot(std::function<QJsonObject()> read);
 QJsonObject saveState()const;void restoreState(const QJsonObject&);
 QByteArray exportEvidence()const;void setHostError(const QString&);
signals:void openNative(QString route,QJsonObject exactTarget);void exportRequested(QByteArray safeEvidence);
};
