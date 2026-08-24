import { mediaConfig } from "@/data/MediaConfig";
import { Form, Formik } from "formik";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import FormBtn from "../../elements/buttons/FormBtn";
import request from "../../utils/axiosUtils";
import { BrandAPI } from "../../utils/axiosUtils/API";
import { YupObject, nameSchema } from "../../utils/validation/ValidationSchemas";
import Loader from "../commonComponent/Loader";
import CheckBoxField from "../inputFields/CheckBoxField";
import FileUploadField from "../inputFields/FileUploadField";
import SimpleInputField from "../inputFields/SimpleInputField";
import useCustomQuery from "@/utils/hooks/useCustomQuery";
import { formatString } from "../../lib/format-number";
import axios from "axios";
const BrandForm = ({ updateId, buttonName, model }) => {
  const { t } = useTranslation("common");
  const router = useRouter();
  const [data, setData] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    fetchDetails();
  }, [updateId]);

  const fetchDetails = async () => {
    try {
      setIsLoading(true);
      let res = await axios.get('/api/brands?brandId=' + updateId);
      if (res.status == 200) {
        setData(res.data.data);
      }
      setIsLoading(false);
    } catch (err) {
      alert('something went wrong');
    }
  }
  if (updateId && isLoading) return <Loader />;

  const handleSubmit = async (values) => {
    try {
      setIsLoading(true);
      if (buttonName == "Update") {
        const res = await axios.put('/api/brands?brandId=' + updateId, {
          "name": values.name,
          "image": values.image,
        }, { withCredentials: true });

        if (res.status == 200) {
          alert('Brand: ' + values.name + " updated successfully!");
         // router.push("/brand");
        }

      } else {
        let slugs = formatString(values.name);
        const res = await axios.post('/api/brands', {
          "name": values.name,
          "slug" : slugs,
          "image": values.image,
          // "description": values.description,
        }, { withCredentials: true });

        if (res.status == 201) {
          alert('Brand: ' + values.name + " added successfully!");
         // router.push("/brand");
        }
      }
      setIsLoading(false);
    } catch (err) {
      console.log('.........', err)
      alert('something went wrong');
    }
  }
  return (
    <>
      <Formik
        enableReinitialize
        initialValues={{
          name: Object.keys(data).length > 1 ? data?.name : "",
          image: Object.keys(data).length > 1 ? data?.image || "" : "",
          // brand_image_id: updateId ? oldData?.data?.brand_image?.id || "" : "",
          // brand_image: updateId ? oldData?.data?.brand_image || "" : "",
          // brand_banner_id: updateId ? oldData?.data?.brand_banner?.id || "" : "",
          // brand_banner: updateId ? oldData?.data?.brand_banner || "" : "",
          // meta_title: updateId ? oldData?.data?.meta_title || "" : "",
          // meta_description: updateId ? oldData?.data?.meta_description || "" : "",
          // brand_meta_image_id: updateId ? oldData?.data?.brand_meta_image?.id : "",
          // brand_meta_image: updateId ? oldData?.data?.brand_meta_image : "",
          // status: updateId ? Boolean(Number(oldData?.data?.status)) : true,
        }}
        validationSchema={YupObject({
          name: nameSchema,
        })}
        onSubmit={(values) => {
          handleSubmit(values);
        }}
      >
        {({ values, setFieldValue, errors, touched }) => (
          <>
            <Form id="blog" className="theme-form theme-form-2 mega-form">
              <SimpleInputField nameList={[{ name: "name", placeholder: t("EnterName"), require: "true" }]} />
              <SimpleInputField nameList={[{ name: "image", title: "Brand logo path", placeholder: "/assets/images/brands/brand-logo.png" }]} />
              {values.image && (
                <div className="mb-4 rounded border bg-white p-3" style={{ maxWidth: 320 }}>
                  <img src={values.image} alt={`${values.name || "Brand"} logo preview`} style={{ width: "100%", height: 120, objectFit: "contain" }} />
                </div>
              )}
              {/* <FileUploadField paramsProps={{ mime_type: mediaConfig.image.join(",") }} name="brand_image_id" title="Image" id="brand_image_id" updateId={updateId} type="file" values={values} setFieldValue={setFieldValue} errors={errors} touched={touched} />
              <FileUploadField paramsProps={{ mime_type: mediaConfig.image.join(",") }} name="brand_banner_id" title="BannerImage" id="brand_banner_id" updateId={updateId} type="file" values={values} setFieldValue={setFieldValue} errors={errors} touched={touched} />
              <SimpleInputField
                nameList={[
                  { name: "meta_title", title: "meta_title", placeholder: t("enter_meta_title") },
                  { name: "meta_description", title: "meta_description", type: "textarea", rows: "3", placeholder: t("enter_meta_description") },
                ]}
              />
              <FileUploadField paramsProps={{ mime_type: mediaConfig.image.join(",") }} name="brand_meta_image_id" id="brand_meta_image_id" title="meta_image" updateId={updateId} type="file" values={values} setFieldValue={setFieldValue} />
              <CheckBoxField name="status" /> */}
              <FormBtn buttonName={buttonName} />
            </Form>
          </>
        )}
      </Formik>
    </>
  );
};

export default BrandForm;
