#pragma once
#include "risk_settings_store.hpp"
#include <QWidget>
#include <QLineEdit>
#include <QLabel>
#include <QComboBox>
#include <QListWidget>
#include <QStackedWidget>
#include <QPlainTextEdit>
#include <QTimer>
#include <functional>
#include <memory>
class RiskSettingsPage:public QWidget {
 std::shared_ptr<RiskSettingsStore> store;
 std::function<QJsonObject()> inputs;
 std::function<void(QJsonObject)> opener;
 std::function<void()> changed;
 QHash<QString,QLineEdit*> fields;
 QComboBox *accounts,*severity;
 QLineEdit* search;
 QListWidget* list;
 QLabel *status,*scope,*counts,*active;
 QStackedWidget* views;
 QPlainTextEdit* original;
 QJsonObject baseline,evaluation,pending,pendingBaseline,selectedAlert;
 QString accountId;
 int page=0;
 bool dirty=false,filling=false,stateWritable=true;
 QTimer timer;
 void guard(std::function<void()>);
 void load(QJsonObject);
 QJsonObject thresholds()const;
 void refresh();
 void render();
 void save(bool defaults=false);
 void showAlert(QJsonObject);
 void locate();
 QString statePath()const;
 QJsonObject state()const;
 void persist()const;
 void restore();
public:
 RiskSettingsPage(std::shared_ptr<RiskSettingsStore>,std::function<QJsonObject()> readInputs,std::function<void(QJsonObject)> openInstrument,std::function<void()> settingsChanged={},QWidget* parent=nullptr);
 ~RiskSettingsPage()override;
 void previewImport(const QByteArray&);
 void confirmImport();
 void cancelImport();
 bool back();
 void setAccount(QString id);
 void setDarkTheme(bool);
 QJsonObject saveState()const;
 void restoreState(const QJsonObject&);
};
