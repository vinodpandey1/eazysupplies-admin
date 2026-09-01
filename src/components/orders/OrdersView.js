"use client";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import axios from "axios";
import ShowModal from "@/elements/alerts&Modals/Modal";
import Btn from "@/elements/buttons/Btn";
import { useRouter } from "next/navigation";
import { OrderEmailTemp } from "../../utils/constants/index";
import { uploadFiles } from "../../utils/customFunctions/fileUpload";
import Loader from "../commonComponent/Loader";
import { getOrderItemPricing, getOrderPricingSummary } from "../../utils/orderPricing";

const OrdersView = ({ id }) => {
    const route = useRouter();
    const [model, setModel] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isApprove, setIsApprove] = useState(false);
    const [isReject, setIsReject] = useState(false);
    const [state, setState] = useState({
        Orders: [],
        qtyTempValue: 0,
        productItemDetails: {},
        editOrderItem: {},
        orderItemQty: 0,
        orderItemPrice: 0,
        shippingModel: false,
        shippingDetails: {},
        shippingProductModel: false,
        shippingProductDetails: {},
        loading: false,
        deliveryAgent: [],
        invoicePdf: "",
        transportReport: "",
        deliveryAgentId: 0,
        deliveryModel: false,
        deliveryFile: ""
    });
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [taxData, setTaxData] = useState();

    const handleStateChange = (name, value) => {
        setState(prev => {
            return { ...prev, [name]: value }
        })
    }

    useEffect(() => {
        const initial = document.body.classList.contains("dark-only");
        setIsDarkMode(initial);
        fetchProduct();
    }, [id])

    const handleView = (el) => {
        handleStateChange('productItemDetails', el);
    }

    const fetchProduct = async (preferredOrderId) => {
        let res = await axios.get('/api/orders/filter?userId=' + id, { withCredentials: true });
        if (res.status == 200) {
            const orders = Array.isArray(res.data.data) ? res.data.data : [];
            setTaxData(res.data.tax);
            setState(prev => {
                const selectedId = Number(preferredOrderId || prev.productItemDetails?.id);
                const selectedOrder = orders.find(el => Number(el.id) === selectedId)
                    || orders[0]
                    || {};
                return {
                    ...prev,
                    Orders: orders,
                    productItemDetails: selectedOrder,
                    deliveryAgent: res.data.deliveryAgent || [],
                    editOrderItem: Object.keys(prev.editOrderItem).length > 0 ? {} : prev.editOrderItem,
                };
            });
        }

    }
    const handleOrderItemUpdate = async () => {
        try {
            const res = await axios.put('/api/orders/auth', {
                "id": Number(state.editOrderItem?.id),
                "quantity": Number(state.orderItemQty !== 0 ? state.orderItemQty : state.editOrderItem?.quantity),
                "price": Number(state.orderItemPrice !== 0 ? state.orderItemPrice : state.editOrderItem?.price)
            }, { withCredentials: true });
            if (res.status == 200) {
                alert("Order item updated successfully!");
                await fetchProduct(state.productItemDetails?.id);
            }
        } catch (err) {
            console.log('error', err);
        }
    }
    const orderItemEdit = (el) => {
        handleStateChange('editOrderItem', el);
        handleStateChange('orderItemQty', el?.quantity);
        handleStateChange('orderItemPrice', el?.price);
    }

    const updateOrderStatus = async (id, action) => {
        try {
            action == "APPROVED" ? setIsApprove(true) : setIsReject(true);
            const res = await axios.put('/api/orders', {
                id: Number(id),
                status: action.toUpperCase(),
                approved: action.toUpperCase() === "APPROVED"
            }, { withCredentials: true });

            if (res.status === 200) {
                alert(`Order ${action.toUpperCase()} successfully!`);
                await fetchProduct(id);
            }
            action == "APPROVED" ? setIsApprove(false) : setIsReject(false);
        } catch (err) {
            console.error('error', err);
            alert(err?.response?.data?.error || err?.response?.data?.msg || "Something went wrong, please try again!");
            action == "APPROVED" ? setIsApprove(false) : setIsReject(false);
        }
    };
    function generateProductTotalPrice(order) {
        return getOrderPricingSummary(order, taxData || []).total;
    }

    const handleHtmlToPdf1 = async (id) => {
        function generateProductRows(products) {
            return products.map(p => {
                const pricing = getOrderItemPricing(state.productItemDetails, p, taxData || []);
                return `
    <tr>
      <td>${p?.product?.name}</td>
      <td>${p?.quantity}</td>
      <td>₹${pricing.unitPrice.toFixed(2)}</td>
      <td>${pricing.discountPercentage}</td>
      <td>${pricing.lineDiscount.toFixed(2)}</td>
      <td>${pricing.taxPercentage}</td>
      <td>${pricing.lineTax.toFixed(2)}</td>
      <td>${pricing.lineTotal.toFixed(2)}</td>
    </tr>
  `;
            }).join("");
        }

        let OrderTemp = OrderEmailTemp;
        let shippingAdds = state.productItemDetails?.shipping.address + ', ' + state.productItemDetails?.shipping?.city + ', ' + state.productItemDetails?.shipping?.country;
        const Total = getOrderPricingSummary(state.productItemDetails, taxData || []).total;
        const productRows = generateProductRows(state.productItemDetails?.items);
        const userId = state?.productItemDetails?.user?.id;
        OrderTemp = OrderTemp.replace('@Order', id);
        OrderTemp = OrderTemp.replace('@OrderDate', state?.productItemDetails?.createdAt.slice(0, -14));
        OrderTemp = OrderTemp.replace('@ShippingAddress', shippingAdds);
        OrderTemp = OrderTemp.replace('@PaymentStatus', state.productItemDetails?.payment?.status);
        OrderTemp = OrderTemp.replace('@ProductBody', productRows);
        OrderTemp = OrderTemp.replace('@totalOrderAmount', Total.toFixed(2));
        const res = await axios.post('/api/file/htmlToPdf', {
            orderId: Number(id),
            userId: userId,
            html: OrderTemp
        }, { withCredentials: true });

    }

    const handleHtmlToPdf = async (id, popup = true) => {
        try {
            setIsLoading(true);
            const res = await axios.get('/api/file/htmlToPdf?orderId=' + id, {
            }, { withCredentials: true });
            if (res.status == 200 && popup) {
                alert(res.data?.message);
                window.open(res?.data?.path, "_blank");
            }
            return res;
        } catch (error) {
            alert(error?.response?.data?.error || "Invoice generation failed. Please try again.");
            throw error;
        } finally {
            setIsLoading(false);
        }
    }

    const handlePayment = (id) => {
        // let Total = 0;
        // for (const el of state.productItemDetails?.items) {
        //     Total += Number(generateProductDiscount(el.product, id).totalPrice * Number(el.quantity));
        // }
        route.push('/payment/edit/' + id);
    }

    const handleShipping = async (id) => {
        if (!state.productItemDetails?.invoicepath) {
            await handleHtmlToPdf(id, false);
            await fetchProduct(id);
        }
        handleStateChange('shippingProductModel', true);
    }
    const handleShippingSubmit = async () => {
        if (state.deliveryAgentId == 0) {
            alert("Delivery Agent is mandatory!");
        } else {
            let invoicePdfRes = "";
            // if(state.invoicePdf != ""){}
            // let formData = new FormData();
            // formData.append("file", state.invoicePdf);
            //  invoicePdfRes = await axios.post(
            //     "/api/file/upload?type=2&namePath=transport",
            //     formData,
            //     {
            //         headers: { "Content-Type": "multipart/form-data" },
            //         withCredentials: true
            //     }
            // );
            // if (invoicePdfRes.status === 200) {
            setIsLoading(true);
            let reportPath = '';
            if (state.transportReport != "") {
                let formData = new FormData();
                formData.append("file", state.transportReport);
                const reportRes = await axios.post(
                    "/api/file/upload?type=2&namePath=transport&orderId=" + state.productItemDetails?.id,
                    formData,
                    {
                        headers: { "Content-Type": "multipart/form-data" },
                        withCredentials: true
                    }
                );
                if (reportRes.status != 200) {
                    alert("Failed to upload transport report, please try again!");
                    setIsLoading(false);
                    return;
                }
                reportPath = reportRes?.data?.url;
            }
            const updateShipping = await axios.put(
                "/api/shippings",
                {
                    id: Number(state.productItemDetails?.shipping?.id),
                    assets: `${"invoicePdf: " + state.productItemDetails?.invoicepath},${"transportReport:" + reportPath}`,
                    deliveryAgent: state.deliveryAgentId,
                    status: "SHIPPED",
                    orderId: Number(state.productItemDetails?.id)
                },
                { withCredentials: true }
            );
            if (updateShipping.status === 200) {
                alert("Shipping process started successfully!");
                handleStateChange('shippingProductModel', false);
                await fetchProduct(state.productItemDetails?.id);
                setIsLoading(false);
            } else {
                alert("Failed to upload transport report, please try again!");
                setIsLoading(false);
            }
            // } else {
            //     alert("Failed to upload invoice pdf, please try again!");
            // }
        }
    }

    const handleDelivery = (id) => {
        handleStateChange("deliveryModel", true);
    }

    const handleDeliverySubmit = async () => {
        if (state.deliveryFile == "") {
            alert("Please upload file to complete delivery!");
        } else {
            setIsLoading(true);
            let formData = new FormData();
            formData.append("file", state.deliveryFile);
            const deliveredFile = await axios.post(
                "/api/file/upload?type=2&namePath=delivery&orderId=" + state.productItemDetails?.id,
                formData,
                {
                    headers: { "Content-Type": "multipart/form-data" },
                    withCredentials: true
                }
            );

            if (deliveredFile.status == 200) {
                const orders = await axios.put('/api/orders/filter?id=' + Number(state.productItemDetails?.id), {
                    "status": "COMPLETED",
                    "delivered": true,
                    "deliveryAgentAssets": `${deliveredFile?.data?.url}`
                }, { withCredentials: true });
                if (orders.status == 200) {
                    alert('Order: ' + state.productItemDetails?.id + " completed successfully!");
                    handleStateChange("deliveryModel", false);
                    await fetchProduct(state.productItemDetails?.id);
                }
                setIsLoading(false);
            }
        }
    }

    if (isLoading) return <Loader />;
    return (
        <>
            <div>
                Orders Details
            </div>
            <div className="d-flex" style={{ width: "100%", minHeight: "100vh" }}>
                {/* Sidebar (Scrollable) */}
                <div
                    className="d-flex flex-column overflow-auto p-2"
                    style={{
                        width: "360px",
                        minWidth: "320px",
                        maxHeight: "calc(100vh - 120px)",
                        overflowY: "auto",
                        borderRight: "1px solid #ccc",
                    }}
                >
                    {state.Orders?.length > 0 ? (
                        state.Orders.map((el, index) => {
                            const isSelected = el.id === state.productItemDetails?.id;
                            const itemCount = el?.items?.length || 0;
                            return (
                                <div
                                    key={el?.id || index}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleView(el)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") handleView(el);
                                    }}
                                    style={{
                                        width: "100%",
                                        marginBottom: "12px",
                                        padding: "14px",
                                        border: isSelected ? "2px solid #e8840d" : "1px solid #dce5dc",
                                        borderRadius: "14px",
                                        backgroundColor: isSelected ? "#0c303d" : "#fff",
                                        color: isSelected ? "#fff" : "#24352c",
                                        boxShadow: isSelected ? "0 8px 20px rgba(12,48,61,.18)" : "0 4px 14px rgba(22,43,31,.06)",
                                        cursor: "pointer",
                                    }}
                                >
                                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                                        <div>
                                            <div className="fw-bold" style={{ fontSize: "17px", lineHeight: 1.25 }}>Order #{el?.id}</div>
                                            <small style={{ opacity: .76 }}>
                                                {el?.createdAt ? new Date(el.createdAt).toLocaleDateString() : "Date unavailable"}
                                            </small>
                                        </div>
                                        <span
                                            className="badge rounded-pill"
                                            style={{
                                                backgroundColor: isSelected ? "#fff" : "#eef7ee",
                                                color: isSelected ? "#0c303d" : "#28743a",
                                                fontSize: "11px",
                                            }}
                                        >
                                            {el?.status || "PENDING"}
                                        </span>
                                    </div>
                                    <div className="d-flex justify-content-between mb-3" style={{ fontSize: "13px", opacity: .85 }}>
                                        <span>{itemCount} {itemCount === 1 ? "item" : "items"}</span>
                                        <strong>₹{generateProductTotalPrice(el)?.toFixed(2)}</strong>
                                    </div>
                                    <div className="d-flex gap-2">
                                        <button
                                            type="button"
                                            className={isSelected ? "btn btn-light btn-sm flex-grow-1" : "btn btn-primary btn-sm flex-grow-1"}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleView(el);
                                            }}
                                        >
                                            View details
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-outline-warning btn-sm"
                                            disabled={!el?.shipping}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setState(prev => ({ ...prev, shippingModel: true, shippingDetails: el?.shipping }));
                                            }}
                                        >
                                            Shipping
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <p></p>
                    )}
                </div>

                {/* Main Content (Static) */}
                <div className="flex-grow-1 p-3">
                    <div
                        id="selected-order-actions"
                        className="w-100 d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3 p-3 bg-white border rounded shadow-sm"
                        style={{ position: "sticky", top: 0, zIndex: 20 }}
                    >
                        <div>
                            <h4 className="mb-1">Order #{state.productItemDetails?.id || "—"}</h4>
                            <div className="small text-muted">
                                {state.productItemDetails?.user?.name || "Customer unavailable"}
                                {state.productItemDetails?.user?.email ? ` · ${state.productItemDetails.user.email}` : ""}
                            </div>
                        </div>
                        {
                            Object.keys(state.productItemDetails).length > 0 &&
                            <div className="d-flex flex-wrap justify-content-end align-items-center gap-2">
                                {state.productItemDetails?.approved && state.productItemDetails?.status?.toUpperCase() === "SHIPPED" && state.productItemDetails?.shipping?.status?.toUpperCase() === "SHIPPED" && <button type="button" onClick={() => handleDelivery(state.productItemDetails?.id)} className="btn btn-info">Delivery</button>}
                                {state.productItemDetails?.approved && state.productItemDetails?.status?.toUpperCase() === "PAID" && <button type="button" onClick={() => handleShipping(state.productItemDetails?.id)} className="btn btn-info">Shipping</button>}
                                {state.productItemDetails?.status?.toUpperCase() === "APPROVED" && state.productItemDetails?.payment?.method == "OFF" && state.productItemDetails?.approved && <button type="button" onClick={() => handlePayment(state.productItemDetails?.payment?.id)} className="btn btn-info">Payment Offline</button>}

                                {state.productItemDetails?.approved ? <span className="d-flex align-items-center gap-2">{state.productItemDetails?.invoicepath ? <>Invoice: <a className="link-primary fw-semibold" href={`/api/invoice/${state.productItemDetails?.id}`} target="_blank" rel="noopener noreferrer">View</a> <a className="link-secondary fw-semibold" href={`/api/file?file=performa-invoice${state.productItemDetails?.id}.pdf`} target="_blank" rel="noopener noreferrer">PDF</a></> : <span className="text-muted small">Invoice unavailable</span>}<button type="button" className="btn btn-success" disabled>Approved</button></span> : state.productItemDetails?.status?.toUpperCase() === "PENDING" ? <button type="button" className="btn btn-success" onClick={() => updateOrderStatus(state.productItemDetails?.id, "APPROVED")} disabled={isApprove} >
                                    {isApprove ? (
                                        <>
                                            <span
                                                className="spinner-border spinner-border-sm me-2"
                                                role="status"
                                                aria-hidden="true"
                                            ></span>
                                            Approving...
                                        </>
                                    ) : (
                                        "Approve"
                                    )}
                                </button> : ''}
                                {state.productItemDetails?.status?.toUpperCase() === "REJECTED" ? <button type="button" className="btn btn-danger" disabled >Rejected</button> : state.productItemDetails?.status?.toUpperCase() === "PENDING" && !state.productItemDetails?.approved ? <button type="button" className="btn btn-danger" onClick={() => updateOrderStatus(state.productItemDetails?.id, "REJECTED")} disabled={isReject} >
                                    {isReject ? (
                                        <>
                                            <span
                                                className="spinner-border spinner-border-sm me-2"
                                                role="status"
                                                aria-hidden="true"
                                            ></span>
                                            Cancelling...
                                        </>
                                    ) : (
                                        "Reject"
                                    )}
                                </button> : ''}
                                {(state.productItemDetails?.approved && ["COMPLETED", "SHIPPED", "PAID"].includes(state.productItemDetails?.status?.toUpperCase())) ? <button type="button" className="btn btn-success" title="invoice" onClick={() => handleHtmlToPdf(state.productItemDetails?.id)} >Invoice </button> : ''}
                                {/* {state.productItemDetails?.approved && state.productItemDetails?.status.toUpperCase() === "SHIPPED" && state.productItemDetails?.shipping?.status.toUpperCase() === "SHIPPED" && <a href={state.productItemDetails?.shipping?.assets?.split(',').find(v => v.startsWith('transportReport:'))?.split('transportReport:')[1]} className="btn btn-info">Transport Report</a>} */}
                                {state.productItemDetails?.approved &&
                                    (state.productItemDetails?.status?.toUpperCase() === "SHIPPED" || state.productItemDetails?.status?.toUpperCase() === "COMPLETED") &&
                                    (state.productItemDetails?.shipping?.status?.toUpperCase() === "SHIPPED") && (
                                        <a
                                            href={
                                                state.productItemDetails?.shipping?.assets
                                                    ?.split(',')
                                                    .find(v => v.startsWith('transportReport:'))
                                                    ?.split('transportReport:')[1]
                                            }
                                            className="link-primary fw-semibold text-decoration-underline"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Transport
                                        </a>
                                    )}

                                {state.productItemDetails?.approved &&
                                    state.productItemDetails?.status?.toUpperCase() === "COMPLETED" &&
                                    state.productItemDetails?.shipping?.status?.toUpperCase() === "SHIPPED" && (
                                        <a
                                            href={
                                                state.productItemDetails?.shipping?.assets
                                                    ?.split(',')
                                                    .find(v => v.startsWith('transportReport:'))
                                                    ?.split('transportReport:')[1]
                                            }
                                            className="link-primary fw-semibold text-decoration-underline"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            delivery doc
                                        </a>
                                    )}

                                {/* <a
                                    href={
                                        state.productItemDetails?.shipping?.assets
                                            ?.split(',')
                                            .find(v => v.startsWith('transportReport:'))
                                            ?.split('transportReport:')[1]
                                    }
                                    className="link-primary fw-semibold text-decoration-underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Delivery Doc
                                </a> */}

                            </div>
                        }
                    </div>

                    {state.productItemDetails?.items?.length > 0 ? (
                        state.productItemDetails.items.map((el, index) => {
                            const pricing = getOrderItemPricing(state.productItemDetails, el, taxData || []);
                            const quantity = pricing.quantity;
                            const price = pricing.unitPrice;
                            const deliveryAgentFilter = state.deliveryAgent?.filter(el => el.id == Number(state.productItemDetails?.deliveryAgent));
                            const {
                                discountPercentage = 0,
                                lineDiscount = 0,
                                taxPercentage = 0,
                                lineTax = 0,
                                taxableSubtotal = 0,
                                lineTotal = 0
                            } = pricing;

                            return (
                                <div key={index} className="card shadow-sm mb-4 border-0">
                                    <div className="card-body p-4">

                                        {/* Header */}
                                        <div className="d-flex justify-content-between align-items-center mb-3">
                                            <h4 className="fw-bold text-primary m-0">{el?.product?.name}</h4>
                                            <span className="badge bg-secondary">Order #{el?.orderId}</span>
                                        </div>

                                        {/* Dates */}
                                        <div className="d-flex gap-2 text-muted small mb-4">
                                            <div>
                                                <strong>Ordered:</strong>{" "}
                                                {el?.createdAt ? new Date(el.createdAt).toLocaleDateString() : "-"}
                                            </div>
                                            <div>
                                                <strong>Updated:</strong>{" "}
                                                {el?.updatedAt ? new Date(el.updatedAt).toLocaleDateString() : "-"}
                                            </div>
                                            <div>
                                                <strong>Payment:</strong>{" "}
                                                {state.productItemDetails?.payment?.status?.toUpperCase() || "NOT SET"}
                                            </div>
                                            <div>
                                                <strong>Shipping:</strong>{" "}
                                                {state.productItemDetails?.shipping?.status?.toUpperCase() || "NOT SET"}
                                            </div>
                                            <div>
                                                <strong>Delivery Agent: {deliveryAgentFilter.length > 0 ? deliveryAgentFilter[0]?.name : "NA"}</strong>{" "}
                                            </div>
                                        </div>

                                        {/* Content Section */}
                                        <div className="row g-3">

                                            {/* Left Column */}
                                            <div className="col-md-6">
                                                <div className="p-3 rounded">
                                                    <p><strong>Price per unit:</strong> ₹{price}</p>
                                                    <p><strong>Quantity:</strong> {quantity}</p>

                                                    {state.editOrderItem?.id === el.id && (
                                                        <input
                                                            type="number"
                                                            className="form-control mt-2"
                                                            placeholder="Enter Quantity"
                                                            value={state.orderItemQty}
                                                            onChange={(e) =>
                                                                handleStateChange("orderItemQty", e.target.value)
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            {/* Right Column */}
                                            <div className="col-md-6">
                                                <div className="p-3 rounded ">
                                                    <p><strong>Discount:</strong> {discountPercentage}%</p>
                                                    <p><strong>Discount Amount:</strong> ₹{lineDiscount.toFixed(2)}</p>

                                                    <p><strong>Tax:</strong> {taxPercentage}%</p>
                                                    <p><strong>Tax Amount:</strong> ₹{lineTax.toFixed(2)}</p>

                                                    <p><strong>Subtotal:</strong> ₹{taxableSubtotal.toFixed(2)}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div className="d-flex justify-content-between align-items-center mt-4">
                                            <h3 className="fw-bold text-success">
                                                Total: ₹{lineTotal.toFixed(2)}
                                            </h3>

                                            {/* Edit Button */}
                                            {/* Uncomment if needed */}
                                            {!state.productItemDetails?.approved && state.productItemDetails?.status?.toUpperCase() === "PENDING" &&
                                                (state.editOrderItem?.id !== el.id ? (
                                                    <button
                                                        className="btn btn-outline-primary btn-sm"
                                                        onClick={() => orderItemEdit(el)}
                                                    >
                                                        Edit
                                                    </button>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={handleOrderItemUpdate}
                                                    >
                                                        Update
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <p className="text-center text-muted py-5">No order items found.</p>
                    )}


                </div>
            </div>
            <ShowModal
                open={state.shippingModel}
                close={false}
                buttons={
                    <>
                        <Btn title="Close" onClick={() => {
                            setState(prev => {
                                return { ...prev, ["shippingModel"]: false, ["shippingDetails"]: {} }
                            })
                        }} className="btn-md btn-outline fw-bold" />
                        {/* <Btn title="Yes" onClick={() => handleLogout()} className="btn-theme btn-md fw-bold" /> */}
                    </>
                }
            >
                {/* <div className="remove-box"> */}
                {
                    Object.keys(state.shippingDetails).length > 0 ?
                        <div>
                            <p>Status: {state.shippingDetails?.status}</p>
                            <p style={{ color: "#0b24ed" }}>Address: {state.shippingDetails?.address}, {state.shippingDetails?.city}, {state.shippingDetails?.state},
                                {state.shippingDetails?.country}- {state.shippingDetails?.postalCode}
                            </p>
                        </div>
                        : <p>No Shipping address available</p>
                }
                {/* </div> */}
            </ShowModal>
            <ShowModal
                open={state.shippingProductModel}
                close={false}
                buttons={
                    <>
                        <Btn title="Close" onClick={() => {
                            setState(prev => {
                                return { ...prev, ["shippingProductModel"]: false, ["shippingProductDetails"]: "" }
                            })
                        }} className="btn-md btn-outline fw-bold" />
                        <Btn title="Save" className="btn-theme btn-md fw-bold" onClick={handleShippingSubmit} />
                    </>
                }
            >
                <div className="p-3">
                    <select
                        className="form-select"
                        name="deliveryAgent"
                        value={state.deliveryAgentId}
                        onChange={(e) =>
                            handleStateChange("deliveryAgentId", Number(e.target.value))
                        }
                    >
                        <option value="" defaultChecked>
                            Select delivery agent
                        </option>

                        {state.deliveryAgent?.map((el, i) => (
                            <option key={"agent" + i} value={el.id}>
                                {el.name}
                            </option>
                        ))}
                    </select>

                    {/* Invoice PDF */}
                    <div className="pt-3 pb-3">
                        <label htmlFor="invoicePdf" className="form-label fw-semibold">
                            Invoice PDF
                        </label>

                        {/* <input
                            type="file"
                            name="invoicePdf"
                            id="invoicePdf"
                            className="form-control"
                            accept="application/pdf"
                            onChange={(e) =>
                                handleStateChange("invoicePdf", e.target.files[0])
                            }
                        /> */}
                        <div className="d-flex justify-content-end">
                            {state.productItemDetails?.invoicepath ? <a href={state.productItemDetails.invoicepath} target="_blank" rel="noopener noreferrer" id="invoicePdf">Invoice</a> : <span className="text-muted">Not available</span>}
                        </div>
                    </div>

                    {/* Transport Report */}
                    <div className="mb-3">
                        <label htmlFor="transportReport" className="form-label fw-semibold">
                            Transport Report
                        </label>

                        <input
                            type="file"
                            name="transportReport"
                            id="transportReport"
                            className="form-control"
                            onChange={(e) =>
                                handleStateChange("transportReport", e.target.files[0])
                            }
                        />
                    </div>

                </div>
            </ShowModal>
            <ShowModal
                open={state.deliveryModel}
                close={false}
                buttons={
                    <>
                        <Btn title="Close" onClick={() => {
                            setState(prev => {
                                return { ...prev, ["deliveryModel"]: false, ["deliveryFile"]: "" }
                            })
                        }} className="btn-md btn-outline fw-bold" />
                        <Btn title="Save" className="btn-theme btn-md fw-bold" onClick={handleDeliverySubmit} />
                    </>
                }
            >
                <div className="p-3">
                    <div className="mb-3">
                        <label htmlFor="deliveryFile" className="form-label fw-semibold">
                            Delivered file
                        </label>

                        <input
                            type="file"
                            name="deliveryFile"
                            id="deliveryFile"
                            className="form-control"
                            onChange={(e) =>
                                handleStateChange("deliveryFile", e.target.files[0])
                            }
                        />
                    </div>

                </div>
            </ShowModal>
        </>
    )
};

export default OrdersView;
