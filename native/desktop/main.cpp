#include <QApplication>
#include <QFont>
#include <QScreen>
#include <QIcon>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMessageBox>
#include <QStandardPaths>
#include <QTextStream>

#include "window.hpp"
#include "stock_data_root.hpp"
#include "native_font_preparation.hpp"
#include <stdexcept>
int main(int argc, char** argv) {
  QApplication app(argc, argv);
  app.setOrganizationName("NativeMarketReview");
  app.setApplicationName("MarketNativeReview");
  // Keep the existing storage identity; branding must not create a new data root.
  app.setApplicationDisplayName("Stock");
  app.setFont(QFont("Microsoft YaHei UI", 10));
  const bool checkDataRoot = app.arguments().contains("--check-data-root");
  try {
    const auto directory = stockLocalData::resolve(
        app.applicationDirPath(),
        QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation));
    if (checkDataRoot) {
      const QJsonObject result{{"dataRoot", directory},
          {"businessDatabase", directory + "/business-v1.sqlite"},
          {"settings", directory + "/review.ini"},
          {"marketDirectory", directory + "/live"},
          {"configured", QFileInfo::exists(app.applicationDirPath() + "/stock-data-root.json")},
          {"windowStarted", false}, {"automaticTasksStarted", false}};
      QTextStream(stdout) << QJsonDocument(result).toJson(QJsonDocument::Compact) << Qt::endl;
      return 0;
    }
    const auto fonts = nativeFontPreparation::prepare();
    if (fonts.canceled) return 0;
    if (!fonts.ready) throw std::runtime_error(fonts.error.toStdString());
    Window w(false, {}, directory);
    app.setWindowIcon(QIcon(":/stock-icon.png"));
    w.setWindowIcon(app.windowIcon());
    const auto area = app.primaryScreen()->availableGeometry();
    w.resize(std::min(1560, area.width() - 24),
             std::min(980, area.height() - 60));
    w.show();
    return app.exec();
  } catch (const std::exception& error) {
    const auto message = QString::fromUtf8(error.what());
    if (checkDataRoot) QTextStream(stderr) << message << Qt::endl;
    else QMessageBox::critical(nullptr, "Stock 数据目录未就绪", message);
    return 1;
  }
}
