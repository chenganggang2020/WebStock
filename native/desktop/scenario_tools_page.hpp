#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QMap>
class QComboBox; class QFormLayout; class QLabel; class QPlainTextEdit;
class ScenarioToolsPage final : public QWidget {
public:
 explicit ScenarioToolsPage(QString draftFile, QWidget* parent=nullptr);
 QJsonObject saveState() const;
 void restoreState(const QJsonObject&);
 static QJsonObject contract();
private:
 QString draftFile, module; QJsonObject drafts; bool restoring=false;
 QComboBox *groups,*tools; QFormLayout* form; QLabel *status,*explanation; QPlainTextEdit* result;
 QMap<QString,QWidget*> editors;
 void selectTool(); void capture(); void invalidate(); void calculate(); void saveDraft(); void clearDraft();
};
