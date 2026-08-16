import useOutsideDropdown from "../../utils/hooks/customHooks/useOutsideDropdown";
import i18next from "i18next";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RiArrowDownSLine, RiTranslate2 } from "react-icons/ri";

const Language = () => {
  const { ref, isComponentVisible, setIsComponentVisible } = useOutsideDropdown(false);
  const { i18n } = useTranslation("common");
  const currentLanguage = i18n.resolvedLanguage;
  const [selectedLang, setSelectedLang] = useState({});
  const router = useRouter();
  // To change Language
  const handleChangeLang = (value) => {
    setSelectedLang(value);
    Cookies.set("i18next", value.lang, { expires: 365, path: "/", sameSite: "lax" });
    i18next.changeLanguage(value.lang);
    router.refresh();
  };
  const langData = [
    { LanuageName: "English", lang: "en", icon: "us" },
    { LanuageName: "Français", lang: "fr", icon: "fr" },
    { LanuageName: "Español", lang: "es", icon: "es" },
    { LanuageName: "العربية", lang: "ar", icon: "ar" },
  ];

  return (
    <li className="profile-nav onhover-dropdown">
      <div className="language-box">
        <RiTranslate2
          onClick={() =>
            setIsComponentVisible((prev) =>
              prev !== "language" ? "language" : ""
            )
          }
        />
        <RiArrowDownSLine className="down-arrow" />
      </div>
      <ul ref={ref} className={`language-dropdown profile-dropdown onhover-show-div ${isComponentVisible == "language" ? "active" : ""}`}>
        {langData?.map((data, i) => {
          if (data.lang === currentLanguage) {
            return null;
          }
          return (
            <li
              key={i}
              onClick={() => handleChangeLang(data)}
              className={`${selectedLang?.lang == data.lang ? "active" : ""}`}
            >
              <a>
                <div className={`iti-flag ${data.icon}`}></div>
                {data.LanuageName}
              </a>
            </li>
          );
        })}
      </ul>
    </li>
  );
};

export default Language;
