#pragma once
#include "ai_settings_store.hpp"
#include <QWidget>
class QLineEdit;class QSpinBox;class QDoubleSpinBox;class QComboBox;class QCheckBox;class QLabel;class QPushButton;class QPlainTextEdit;
class AiSettingsPage:public QWidget {
 Q_OBJECT
 aiSettings::Store store;QJsonObject saved,preview;QJsonArray hostReports;
 QComboBox* provider;QLineEdit *model,*endpoint;QSpinBox *timeout,*tokens;QDoubleSpinBox* temperature;QCheckBox *sendTemperature,*enabled;QLabel* message;QPlainTextEdit *evidence,*importText;QPushButton *handoff,*apply;
 QJsonObject draft()const;void fill(const QJsonObject&);void refresh();void invalidate();
public:
 explicit AiSettingsPage(QString dedicatedSqlite,QWidget* parent=nullptr);
 QJsonObject saveState()const;void restoreState(const QJsonObject&);
 void setHostError(const QString&);void previewImport(const QByteArray&);
 QByteArray exportArchive()const;QJsonObject savedConfig()const;
 void setManualHandoffAvailable(bool);void setHostCapabilities(const QJsonObject&);
signals:void openManualHandoff();void configurationSaved(QJsonObject nonSecretPreferences);
};
